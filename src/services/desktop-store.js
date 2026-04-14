import { DEFAULT_CONFIG } from "../shared/defaults.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export class DesktopStore {
  async bootstrap() {
    const payload = await window.meetingDesktop.getBootstrap();
    return {
      ...payload,
      config: { ...clone(DEFAULT_CONFIG), ...(payload?.config || {}) },
      sessions: Array.isArray(payload?.sessions) ? payload.sessions : [],
    };
  }

  async saveConfig(config) {
    return window.meetingDesktop.saveConfig(config);
  }

  async listSessions() {
    return window.meetingDesktop.listSessions();
  }

  async getSession(sessionId) {
    return window.meetingDesktop.getSession(sessionId);
  }

  async saveSession(session) {
    return window.meetingDesktop.saveSession(session);
  }

  async deleteSession(sessionId) {
    return window.meetingDesktop.deleteSession(sessionId);
  }
}
