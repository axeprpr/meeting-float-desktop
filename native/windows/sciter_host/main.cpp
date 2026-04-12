#define WIN32_LEAN_AND_MEAN

#include <windows.h>
#include <shellapi.h>
#include <shlwapi.h>

#include <filesystem>
#include <string>

#include "sciter-x-api.h"
#include "sciter-x-behavior.h"

namespace fs = std::filesystem;

using audio_noarg_fn = char*(__stdcall*)();
using audio_with_arg_fn = char*(__stdcall*)(const char*);
using audio_free_fn = void(__stdcall*)(char*);

struct audio_exports {
  HMODULE module = nullptr;
  audio_noarg_fn health = nullptr;
  audio_with_arg_fn configure = nullptr;
  audio_with_arg_fn probe = nullptr;
  audio_with_arg_fn start = nullptr;
  audio_noarg_fn pause = nullptr;
  audio_noarg_fn resume = nullptr;
  audio_noarg_fn stop = nullptr;
  audio_free_fn free_string = nullptr;

  bool ok() const {
    return module && health && configure && probe && start && pause && resume && stop && free_string;
  }
};

static std::wstring widen(const std::string& input) {
  if (input.empty()) return {};
  const int size = MultiByteToWideChar(CP_UTF8, 0, input.data(), static_cast<int>(input.size()), nullptr, 0);
  std::wstring output(size, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, input.data(), static_cast<int>(input.size()), output.data(), size);
  return output;
}

static std::string narrow(const std::wstring& input) {
  if (input.empty()) return {};
  const int size = WideCharToMultiByte(CP_UTF8, 0, input.data(), static_cast<int>(input.size()), nullptr, 0, nullptr, nullptr);
  std::string output(size, '\0');
  WideCharToMultiByte(CP_UTF8, 0, input.data(), static_cast<int>(input.size()), output.data(), size, nullptr, nullptr);
  return output;
}

static std::string extract_arg(const sciter::value& arg) {
  return narrow(arg.to_string());
}

static sciter::value call_audio(audio_noarg_fn fn, audio_free_fn free_string) {
  if (!fn || !free_string) {
    return sciter::value::make_error("meeting_audio.dll is not loaded");
  }

  char* raw = fn();
  if (!raw) {
    return sciter::value::make_error("native audio function returned null");
  }

  std::string payload(raw);
  free_string(raw);
  return sciter::value::make_string(payload.c_str());
}

static sciter::value call_audio(audio_with_arg_fn fn, audio_free_fn free_string, const std::string& arg) {
  if (!fn || !free_string) {
    return sciter::value::make_error("meeting_audio.dll is not loaded");
  }

  char* raw = fn(arg.c_str());
  if (!raw) {
    return sciter::value::make_error("native audio function returned null");
  }

  std::string payload(raw);
  free_string(raw);
  return sciter::value::make_string(payload.c_str());
}

class audio_bridge final : public sciter::event_handler_raw {
public:
  explicit audio_bridge(audio_exports* exports) : exports_(exports) {}

  bool subscription(HELEMENT, UINT& event_groups) override {
    event_groups = HANDLE_SCRIPTING_METHOD_CALL;
    return true;
  }

  bool on_script_call(HELEMENT, LPCSTR name, UINT argc, const sciter::value* argv, sciter::value& retval) override {
    if (!name) {
      retval = sciter::value::make_error("missing method name");
      return true;
    }

    const std::string method(name);
    if (method == "meetingAudioHealth") {
      retval = call_audio(exports_->health, exports_->free_string);
      return true;
    }
    if (method == "meetingAudioConfigure") {
      retval = call_audio(exports_->configure, exports_->free_string, argc > 0 ? extract_arg(argv[0]) : "{}");
      return true;
    }
    if (method == "meetingAudioProbe") {
      retval = call_audio(exports_->probe, exports_->free_string, argc > 0 ? extract_arg(argv[0]) : "{}");
      return true;
    }
    if (method == "meetingAudioStart") {
      retval = call_audio(exports_->start, exports_->free_string, argc > 0 ? extract_arg(argv[0]) : "{}");
      return true;
    }
    if (method == "meetingAudioPause") {
      retval = call_audio(exports_->pause, exports_->free_string);
      return true;
    }
    if (method == "meetingAudioResume") {
      retval = call_audio(exports_->resume, exports_->free_string);
      return true;
    }
    if (method == "meetingAudioStop") {
      retval = call_audio(exports_->stop, exports_->free_string);
      return true;
    }

    return false;
  }

private:
  audio_exports* exports_;
};

static audio_exports load_audio_exports(const fs::path& app_dir) {
  audio_exports exports;
  const fs::path dll_path = app_dir / "meeting_audio.dll";
  exports.module = LoadLibraryW(dll_path.c_str());
  if (!exports.module) {
    return exports;
  }

  exports.health = reinterpret_cast<audio_noarg_fn>(GetProcAddress(exports.module, "meeting_audio_health"));
  exports.configure = reinterpret_cast<audio_with_arg_fn>(GetProcAddress(exports.module, "meeting_audio_configure"));
  exports.probe = reinterpret_cast<audio_with_arg_fn>(GetProcAddress(exports.module, "meeting_audio_probe"));
  exports.start = reinterpret_cast<audio_with_arg_fn>(GetProcAddress(exports.module, "meeting_audio_start"));
  exports.pause = reinterpret_cast<audio_noarg_fn>(GetProcAddress(exports.module, "meeting_audio_pause"));
  exports.resume = reinterpret_cast<audio_noarg_fn>(GetProcAddress(exports.module, "meeting_audio_resume"));
  exports.stop = reinterpret_cast<audio_noarg_fn>(GetProcAddress(exports.module, "meeting_audio_stop"));
  exports.free_string = reinterpret_cast<audio_free_fn>(GetProcAddress(exports.module, "meeting_audio_free_string"));
  return exports;
}

static void set_bridge_flag(HWINDOW hwnd) {
  sciter::value enabled(true);
  SAPI()->SciterSetVariable(hwnd, L"globalThis.__MEETING_AUDIO_XCALL__", &enabled);
}

static LRESULT CALLBACK window_delegate(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam, LPVOID, BOOL* handled) {
  if (msg == WM_CLOSE || msg == WM_DESTROY) {
    PostQuitMessage(0);
    if (handled) *handled = FALSE;
  }
  return 0;
}

int APIENTRY wWinMain(HINSTANCE, HINSTANCE, LPWSTR, int) {
  OleInitialize(nullptr);
  SciterSetOption(nullptr, SCITER_SET_UX_THEMING, TRUE);
  SciterSetOption(nullptr, SCITER_SET_SCRIPT_RUNTIME_FEATURES, ALLOW_FILE_IO | ALLOW_SOCKET_IO | ALLOW_EVAL | ALLOW_SYSINFO);

  wchar_t module_path[MAX_PATH] = {0};
  GetModuleFileNameW(nullptr, module_path, MAX_PATH);
  fs::path app_dir = fs::path(module_path).parent_path();
  SetCurrentDirectoryW(app_dir.c_str());

  auto exports = load_audio_exports(app_dir);
  audio_bridge bridge(&exports);

  RECT frame = {0, 0, 700, 860};
  UINT flags = SW_MAIN | SW_TITLEBAR | SW_RESIZEABLE | SW_CONTROLS | SW_TOOL | SW_ENABLE_DEBUG;
  HWINDOW hwnd = SciterCreateWindow(flags, &frame, &window_delegate, nullptr, nullptr);
  if (!hwnd) {
    MessageBoxW(nullptr, L"Failed to create Sciter window.", L"Meeting Float Native", MB_ICONERROR | MB_OK);
    OleUninitialize();
    return 1;
  }

  SciterWindowAttachEventHandler(hwnd, &sciter::event_handler_raw::element_proc, &bridge, HANDLE_SCRIPTING_METHOD_CALL);
  set_bridge_flag(hwnd);

  const fs::path index_path = app_dir / "index.htm";
  if (!SciterLoadFile(hwnd, index_path.c_str())) {
    MessageBoxW(nullptr, L"Failed to load index.htm.", L"Meeting Float Native", MB_ICONERROR | MB_OK);
    OleUninitialize();
    return 2;
  }

  ShowWindow(hwnd, SW_SHOW);
  UpdateWindow(hwnd);

  MSG msg;
  while (GetMessageW(&msg, nullptr, 0, 0)) {
    if (!SciterTranslateMessage(&msg)) {
      TranslateMessage(&msg);
      DispatchMessageW(&msg);
    }
  }

  SciterWindowDetachEventHandler(hwnd, &sciter::event_handler_raw::element_proc, &bridge);
  if (exports.module) {
    FreeLibrary(exports.module);
  }
  OleUninitialize();
  return static_cast<int>(msg.wParam);
}
