package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gen2brain/malgo"
	"github.com/gorilla/websocket"
)

const (
	listenAddr        = "127.0.0.1:17995"
	sampleRate        = 16000
	channels          = 1
	bytesPerSample    = 2
	defaultChunkSize  = "8,8,4"
	defaultMode       = "2pass"
	defaultFunASRURL  = "ws://192.168.3.42:10095"
	finalDrainTimeout = 700 * time.Millisecond
)

type recorderConfig struct {
	FunASRURL     string `json:"funasr_url"`
	ChunkSize     string `json:"chunk_size"`
	ChunkInterval int    `json:"chunk_interval"`
	Mode          string `json:"mode"`
	Language      string `json:"language"`
}

type controlRequest struct {
	ChunkSeconds int `json:"chunk_seconds"`
}

type helperState struct {
	Status       string `json:"status"`
	Paused       bool   `json:"paused"`
	FunASRURL    string `json:"funasr_url"`
	LastError    string `json:"last_error"`
	Preview      string `json:"preview"`
	BridgeReady  bool   `json:"bridge_ready"`
	SampleRate   int    `json:"sample_rate"`
	ChunkBytes   int    `json:"chunk_bytes"`
	UpdatedAt    string `json:"updated_at"`
	ChunkSeconds int    `json:"chunk_seconds"`
}

type event struct {
	Seq       int64  `json:"seq"`
	Type      string `json:"type"`
	Text      string `json:"text,omitempty"`
	Mode      string `json:"mode,omitempty"`
	Final     bool   `json:"final,omitempty"`
	CreatedAt string `json:"created_at"`
}

type eventStore struct {
	mu     sync.Mutex
	next   int64
	events []event
}

func (s *eventStore) add(eventType, text, mode string, final bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.next++
	s.events = append(s.events, event{
		Seq:       s.next,
		Type:      eventType,
		Text:      text,
		Mode:      mode,
		Final:     final,
		CreatedAt: time.Now().Format(time.RFC3339),
	})
	if len(s.events) > 512 {
		s.events = append([]event(nil), s.events[len(s.events)-512:]...)
	}
}

func (s *eventStore) since(seq int64) ([]event, int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]event, 0, len(s.events))
	for _, item := range s.events {
		if item.Seq > seq {
			out = append(out, item)
		}
	}
	return out, s.next
}

type recorder struct {
	cfg       recorderConfig
	device    *malgo.Device
	ctx       *malgo.AllocatedContext
	ws        *websocket.Conn
	audioCh   chan []byte
	stopCh    chan struct{}
	doneCh    chan struct{}
	chunkSize int
	store     *eventStore
	onPreview func(string)
	onError   func(string)
}

func newRecorder(cfg recorderConfig, store *eventStore, onPreview func(string), onError func(string)) *recorder {
	return &recorder{
		cfg:       cfg,
		audioCh:   make(chan []byte, 128),
		stopCh:    make(chan struct{}),
		doneCh:    make(chan struct{}),
		chunkSize: computeChunkBytes(cfg.ChunkSize, cfg.ChunkInterval),
		store:     store,
		onPreview: onPreview,
		onError:   onError,
	}
}

func computeChunkBytes(chunkSize string, chunkInterval int) int {
	parts := strings.Split(chunkSize, ",")
	middle := 8
	if len(parts) > 1 {
		if value, err := strconv.Atoi(strings.TrimSpace(parts[1])); err == nil && value > 0 {
			middle = value
		}
	}
	if chunkInterval <= 0 {
		chunkInterval = 10
	}
	ms := 60 * middle / chunkInterval
	if ms <= 0 {
		ms = 48
	}
	return sampleRate * channels * bytesPerSample * ms / 1000
}

func (r *recorder) start() error {
	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
		Subprotocols:     []string{"binary"},
	}
	conn, _, err := dialer.Dial(r.cfg.FunASRURL, nil)
	if err != nil {
		return fmt.Errorf("连接转写服务失败: %w", err)
	}
	r.ws = conn

	if err := r.sendConfig(true); err != nil {
		r.ws.Close()
		return err
	}

	if err := r.startCapture(); err != nil {
		r.ws.Close()
		return err
	}

	go r.sendLoop()
	go r.recvLoop()
	return nil
}

func (r *recorder) sendConfig(isSpeaking bool) error {
	message := map[string]any{
		"mode":                    r.cfg.Mode,
		"chunk_size":              parseChunkList(r.cfg.ChunkSize),
		"chunk_interval":          r.cfg.ChunkInterval,
		"encoder_chunk_look_back": 4,
		"decoder_chunk_look_back": 0,
		"audio_fs":                sampleRate,
		"wav_name":                "meeting-assistant",
		"is_speaking":             isSpeaking,
		"itn":                     true,
	}
	return r.ws.WriteJSON(message)
}

func parseChunkList(chunkSize string) []int {
	values := []int{8, 8, 4}
	parts := strings.Split(chunkSize, ",")
	if len(parts) != 3 {
		return values
	}
	out := make([]int, 0, 3)
	for _, item := range parts {
		value, err := strconv.Atoi(strings.TrimSpace(item))
		if err != nil || value <= 0 {
			return values
		}
		out = append(out, value)
	}
	return out
}

func (r *recorder) startCapture() error {
	contextConfig := malgo.ContextConfig{}
	ctx, err := malgo.InitContext(nil, contextConfig, func(message string) {})
	if err != nil {
		return fmt.Errorf("初始化录音上下文失败: %w", err)
	}
	r.ctx = ctx

	deviceConfig := malgo.DefaultDeviceConfig(malgo.Capture)
	deviceConfig.Capture.Format = malgo.FormatS16
	deviceConfig.Capture.Channels = channels
	deviceConfig.SampleRate = sampleRate
	deviceConfig.Alsa.NoMMap = 1

	onRecvFrames := func(_, inputSamples []byte, _ uint32) {
		if len(inputSamples) == 0 {
			return
		}
		copyBuf := append([]byte(nil), inputSamples...)
		select {
		case r.audioCh <- copyBuf:
		default:
		}
	}

	deviceCallbacks := malgo.DeviceCallbacks{
		Data: onRecvFrames,
	}

	device, err := malgo.InitDevice(r.ctx.Context, deviceConfig, deviceCallbacks)
	if err != nil {
		r.ctx.Uninit()
		r.ctx.Free()
		r.ctx = nil
		return fmt.Errorf("初始化录音设备失败: %w", err)
	}
	r.device = device

	if err = r.device.Start(); err != nil {
		r.device.Uninit()
		r.device = nil
		r.ctx.Uninit()
		r.ctx.Free()
		r.ctx = nil
		return fmt.Errorf("启动录音失败: %w", err)
	}

	return nil
}

func (r *recorder) sendLoop() {
	defer close(r.doneCh)

	buffer := bytes.NewBuffer(nil)
	for {
		select {
		case data := <-r.audioCh:
			buffer.Write(data)
			for buffer.Len() >= r.chunkSize {
				packet := make([]byte, r.chunkSize)
				if _, err := buffer.Read(packet); err != nil {
					r.onError(err.Error())
					return
				}
				if err := r.ws.WriteMessage(websocket.BinaryMessage, packet); err != nil {
					r.onError(fmt.Sprintf("发送音频失败: %v", err))
					return
				}
			}
		case <-r.stopCh:
			if buffer.Len() > 0 {
				_ = r.ws.WriteMessage(websocket.BinaryMessage, append([]byte(nil), buffer.Bytes()...))
			}
			_ = r.ws.WriteJSON(map[string]any{"is_speaking": false})
			time.Sleep(finalDrainTimeout)
			_ = r.ws.Close()
			return
		}
	}
}

func (r *recorder) recvLoop() {
	for {
		var payload map[string]any
		if err := r.ws.ReadJSON(&payload); err != nil {
			if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				return
			}
			if !strings.Contains(strings.ToLower(err.Error()), "closed") {
				r.onError(fmt.Sprintf("接收转写结果失败: %v", err))
			}
			return
		}

		mode, _ := payload["mode"].(string)
		text, _ := payload["text"].(string)
		if text == "" {
			continue
		}

		if strings.Contains(mode, "offline") {
			r.store.add("final_transcript", text, mode, true)
			r.onPreview("")
		} else {
			r.store.add("preview", text, mode, false)
			r.onPreview(text)
		}
	}
}

func (r *recorder) stop() {
	select {
	case <-r.stopCh:
	default:
		close(r.stopCh)
	}
	<-r.doneCh

	if r.device != nil {
		r.device.Stop()
		r.device.Uninit()
		r.device = nil
	}
	if r.ctx != nil {
		r.ctx.Uninit()
		r.ctx.Free()
		r.ctx = nil
	}
}

type helper struct {
	mu       sync.Mutex
	cfg      recorderConfig
	rec      *recorder
	state    helperState
	events   *eventStore
}

func newHelper() *helper {
	defaultCfg := recorderConfig{
		FunASRURL:     defaultFunASRURL,
		ChunkSize:     defaultChunkSize,
		ChunkInterval: 10,
		Mode:          defaultMode,
		Language:      "zh",
	}
	return &helper{
		cfg:    defaultCfg,
		events: &eventStore{},
		state: helperState{
			Status:      "idle",
			FunASRURL:   defaultCfg.FunASRURL,
			BridgeReady: true,
			SampleRate:  sampleRate,
			ChunkBytes:  computeChunkBytes(defaultCfg.ChunkSize, defaultCfg.ChunkInterval),
			UpdatedAt:   time.Now().Format(time.RFC3339),
		},
	}
}

func (h *helper) setStatus(status string, paused bool) {
	h.state.Status = status
	h.state.Paused = paused
	h.state.UpdatedAt = time.Now().Format(time.RFC3339)
}

func (h *helper) setError(message string) {
	h.state.LastError = message
	h.state.UpdatedAt = time.Now().Format(time.RFC3339)
	h.events.add("error", message, "", false)
}

func (h *helper) clearError() {
	h.state.LastError = ""
	h.state.UpdatedAt = time.Now().Format(time.RFC3339)
}

func (h *helper) configure(w http.ResponseWriter, r *http.Request) {
	var req recorderConfig
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "配置格式不正确"})
		return
	}

	h.mu.Lock()
	defer h.mu.Unlock()

	if req.FunASRURL != "" {
		h.cfg.FunASRURL = req.FunASRURL
	}
	if req.ChunkSize != "" {
		h.cfg.ChunkSize = req.ChunkSize
	}
	if req.ChunkInterval > 0 {
		h.cfg.ChunkInterval = req.ChunkInterval
	}
	if req.Mode != "" {
		h.cfg.Mode = req.Mode
	}
	if req.Language != "" {
		h.cfg.Language = req.Language
	}

	h.state.FunASRURL = h.cfg.FunASRURL
	h.state.ChunkBytes = computeChunkBytes(h.cfg.ChunkSize, h.cfg.ChunkInterval)
	h.state.UpdatedAt = time.Now().Format(time.RFC3339)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "state": h.state})
}

func (h *helper) health(w http.ResponseWriter, _ *http.Request) {
	h.mu.Lock()
	defer h.mu.Unlock()
	writeJSON(w, http.StatusOK, h.state)
}

func (h *helper) probe(w http.ResponseWriter, r *http.Request) {
	var req recorderConfig
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "测试参数不正确"})
		return
	}
	if req.FunASRURL == "" {
		req.FunASRURL = h.cfg.FunASRURL
	}
	dialer := websocket.Dialer{
		HandshakeTimeout: 5 * time.Second,
		Subprotocols:     []string{"binary"},
	}
	conn, _, err := dialer.Dial(req.FunASRURL, nil)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":         false,
			"modelFound": false,
			"message":    fmt.Sprintf("无法连接转写服务：%v", err),
		})
		return
	}
	_ = conn.Close()
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":         true,
		"modelFound": true,
		"message":    "转写服务连接正常",
	})
}

func (h *helper) startRecord(w http.ResponseWriter, r *http.Request) {
	var req controlRequest
	_ = json.NewDecoder(r.Body).Decode(&req)

	h.mu.Lock()
	defer h.mu.Unlock()
	if h.rec != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "state": h.state})
		return
	}

	rec := newRecorder(h.cfg, h.events, func(text string) {
		h.mu.Lock()
		h.state.Preview = text
		h.state.UpdatedAt = time.Now().Format(time.RFC3339)
		h.mu.Unlock()
	}, func(message string) {
		h.mu.Lock()
		defer h.mu.Unlock()
		h.setError(message)
		if h.rec != nil {
			go h.rec.stop()
			h.rec = nil
		}
		h.setStatus("idle", false)
	})

	if err := rec.start(); err != nil {
		h.setError(err.Error())
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}

	h.rec = rec
	h.state.ChunkSeconds = req.ChunkSeconds
	h.clearError()
	h.setStatus("recording", false)
	h.events.add("status", "录音开始", "", false)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "state": h.state})
}

func (h *helper) pauseRecord(w http.ResponseWriter, _ *http.Request) {
	h.mu.Lock()
	rec := h.rec
	h.rec = nil
	h.setStatus("paused", true)
	h.events.add("status", "录音暂停", "", false)
	h.mu.Unlock()

	if rec != nil {
		rec.stop()
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "state": h.state})
}

func (h *helper) resumeRecord(w http.ResponseWriter, r *http.Request) {
	h.startRecord(w, r)
}

func (h *helper) stopRecord(w http.ResponseWriter, _ *http.Request) {
	h.mu.Lock()
	rec := h.rec
	h.rec = nil
	h.state.Preview = ""
	h.setStatus("idle", false)
	h.events.add("status", "录音结束", "", false)
	h.mu.Unlock()

	if rec != nil {
		rec.stop()
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "state": h.state})
}

func (h *helper) listEvents(w http.ResponseWriter, r *http.Request) {
	seq, _ := strconv.ParseInt(r.URL.Query().Get("since"), 10, 64)
	items, next := h.events.since(seq)
	writeJSON(w, http.StatusOK, map[string]any{
		"events":   items,
		"next_seq": next,
	})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)
	app := newHelper()

	mux := http.NewServeMux()
	mux.HandleFunc("/health", app.health)
	mux.HandleFunc("/config", app.configure)
	mux.HandleFunc("/probe", app.probe)
	mux.HandleFunc("/events", app.listEvents)
	mux.HandleFunc("/record/start", app.startRecord)
	mux.HandleFunc("/record/pause", app.pauseRecord)
	mux.HandleFunc("/record/resume", app.resumeRecord)
	mux.HandleFunc("/record/stop", app.stopRecord)

	server := &http.Server{
		Addr:              listenAddr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Printf("meeting helper listening on http://%s", listenAddr)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
