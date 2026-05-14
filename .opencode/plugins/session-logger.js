
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let SESSION_DIR = process.env.OPENCODE_SESSION_DIR || "";
let DEBUG = process.env.OPENCODE_LOGGER_DEBUG === "1" || null;

let DEBUG_LOG = path.join(SESSION_DIR, "debug.log");

function loadPluginConfig() {
  const pluginPath = __filename;
  const pluginDir = path.dirname(pluginPath);
  const parentDir = path.dirname(pluginDir);
  
  const configFiles = [
    path.join(pluginDir, "session-logger.json"),
    path.join(parentDir, "session-logger.json"),
  ];
  
  let loadedConfig = {};
  
  for (const configFile of configFiles) {
    try {
      if (fs.existsSync(configFile)) {
        const content = fs.readFileSync(configFile, "utf8");
        loadedConfig = JSON.parse(content);
        debugLog('Loaded plugin config: ' + JSON.stringify(loadedConfig));
        if (SESSION_DIR === "") {
          SESSION_DIR = loadedConfig.sessionsDir || SESSION_DIR;
          if (SESSION_DIR === "")
            DEBUG = false;
        }
        if (SESSION_DIR != "")
          DEBUG_LOG = path.join(SESSION_DIR, "debug.log");
        if (DEBUG === null)
          DEBUG = loadedConfig.debug === true;
        debugLog(`Plugin config loaded from: ${configFile}`);
        return loadedConfig;
      }
    } catch (e) {}
  }
  return {};
}

const pluginConfig = loadPluginConfig();


function debugLog(msg) {
  // NOTE: SESSION_DIR must exist and DEBUG must be true for logs to write
  if (!DEBUG) return;
  try {
    fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] ${msg}\n`);
  } catch (e) {}
}

debugLog(`Plugin initialized: sessionsDir=${SESSION_DIR}, debug=${DEBUG}`);

function ensureSessionDir() {
  if (SESSION_DIR === "")
    return false;
  return fs.existsSync(SESSION_DIR);
}

function sanitizeFilename(str) {
  return (str || "").replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 50);
}

function formatTimestamp(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function findExistingSessionFile(sessionId) {
  try {
    const files = fs.readdirSync(SESSION_DIR);
    return files.find(f => f.includes(sessionId)) || null;
  } catch (e) {
    return null;
  }
}

function log(content, filePath, tag) {
  try {
    let lineNum = '';
    if (DEBUG) {
      try { throw new Error(); } catch (e) {
        const stack = e.stack.split('\n')[2];
        const match = stack.match(/:(\d+):/);
        lineNum = match ? `(line${match[1]})` : '';
      }
    }
    if (typeof content === "string") {
      content = content.replace(/\\n/g, "\n");
    }
    if (DEBUG) {
      content = `\n[${tag || ''}${lineNum}]\n${content}`;
    }
    fs.appendFileSync(filePath, content);
  } catch (e) {}
}

function flushLog(filePath) {
  try {
    fs.fsyncSync(fs.openSync(filePath, "r+"));
  } catch {}
}

const activeSessions = new Map();

class SessionState {
  constructor(sessionID, logFile, title, timestamp) {
    this.sessionID = sessionID;
    this._logFile = logFile;
    this.title = title;
    this.logFile = logFile;
    this.processedMessages = new Set();
    this.loggedDeltas = new Set();
    this.processedTools = new Set();
    this.processedPermissions = new Set();
    this.isReasoning = false;
    this.reasoningPartIDs = new Set();
    this.lastDiff = [];
    this.lastPermission = null;
    this.symlinkPath = path.join(SESSION_DIR, "current_session.md");
    this._timestamp = timestamp;
    this._updateSymlink();
  }

  set logFile(value) {
    this._logFile = value;
    this._updateSymlink();
  }

  get logFile() {
    return this._logFile;
  }

  set title(value) {
    const oldLogFile = this._logFile;
    this._title = value;
    if (value && value !== this.startTitle) {
      const newLogFile = SessionState.getLogFile(this.sessionID, value, this._timestamp);
      if (newLogFile !== oldLogFile) {
        try {
          fs.renameSync(oldLogFile, newLogFile);
          this._logFile = newLogFile;
          this._updateSymlink();
        } catch (e) {}
      }
      log(`\n> **[Title Updated]** ${new Date().toISOString()}: ${value}\n`, this._logFile);
    }
  }

  get title() {
    return this._title;
  }

  _updateSymlink() {

    if (!this.logFile || !this.symlinkPath) return;
    try {
      if (fs.existsSync(this.symlinkPath)) {
        fs.unlinkSync(this.symlinkPath);
      }
      const relativeTarget = path.basename(this.logFile);
      fs.symlinkSync(relativeTarget, this.symlinkPath);

    } catch (e) {
      debugLog(`    Symlink error: ${e.message}`);
    }
  }

  _removeSymlink() {
    if (!this.symlinkPath) return;
    try {
      if (fs.existsSync(this.symlinkPath)) {
        fs.unlinkSync(this.symlinkPath);
      }
    } catch (e) {
      debugLog(`Symlink remove error: ${e.message}`);
    }
  }

  finalizeSession() {
    debugLog(`  session ${this.sessionID}: logFile=${this.logFile}, lastDiff=${JSON.stringify(this.lastDiff)}`);
    if (!this.logFile || !fs.existsSync(this.logFile)) return;
    const timestamp = new Date().toISOString();
    log(`\n> --- Session ended ${timestamp} ---\n`, this.logFile);
    if (this.lastDiff && this.lastDiff.length > 0) {
      log(`\n> Changed files:\n`, this.logFile);
      for (const d of this.lastDiff) {
        const sign = d.status === "added" ? "A" : d.status === "deleted" ? "D" : "M";
        const stat = d.additions || d.deletions ? ` (+${d.additions || 0}/-${d.deletions || 0})` : "";
        log(`>   ${sign} ${d.file}${stat}\n`, this.logFile);
      }
    }
    this._removeSymlink();
  }

  static getLogFile(sessionId, title, timestamp) {
    const ts = timestamp || formatTimestamp(new Date());
    if (sessionId) {
      const name = title ? `${sessionId}-${sanitizeFilename(title)}` : sessionId;
      return path.join(SESSION_DIR, `${ts}-${name}.md`);
    }
    return path.join(SESSION_DIR, `${ts}.md`);
  }

  static createOrRestore(sessionID, info, ctx) {
    const existing = activeSessions.get(sessionID);
    if (existing) {
      debugLog(`SessionState.createOrRestore: found existing state for ${sessionID}`);
      return existing;
    }

    const title = info?.title || info?.slug || "";
    const startTime = info?.time?.created ? new Date(info.time.created) : new Date();
    const timestamp = formatTimestamp(startTime);

    const existingFile = findExistingSessionFile(sessionID);
    let logFile;
    let isNew = false;

    if (existingFile) {
      logFile = path.join(SESSION_DIR, existingFile);
    } else {
      logFile = SessionState.getLogFile(sessionID, title, timestamp);
      isNew = true;
    }

    const state = new SessionState(sessionID, logFile, title, timestamp);
    activeSessions.set(sessionID, state);

    if (isNew) {
      const header = [
        "---",
        `## Session: ${sessionID}`,
        title ? `### Title: ${title}` : "",
        `Started: ${startTime}`,
        `Directory: ${ctx.directory}`,
        info.summary ? `### Summary: +${info.summary.additions}/-${info.summary.deletions} in ${info.summary.files} files` : "",
        "---",
        "",
        "## Chat History",
        "",
      ].filter((line) => line !== "").join("\n");

      log(header, state.logFile);
      flushLog(state.logFile);
    }

    return state;
  }
}

function getSession(sessionID) {
  const state = activeSessions.get(sessionID);
  if (state) {
    state._updateSymlink();
  }
  return state;
}

export const server = async function (ctx) {
  console.error("PLUGIN: server function called! ctx=", ctx);
  debugLog(`=== Plugin called (ensureSessionDir=${ensureSessionDir()}) ===`);
  if (!ensureSessionDir()) {
    if (SESSION_DIR === "") {
      debugLog("No session directory configured. Set OPENCODE_SESSION_DIR env variable or provide session-logger.json config.");
    } else {
      debugLog(`Session directory ${SESSION_DIR} not exists`);
    }
 
    return {
      event: async function () {
        // No-op if session directory is not available
      },
    };
  }

  return {
    event: async function (input) {
      try {
        eventHandler(input);
      } catch (e) {
        debugLog(`event ERROR: ${e.message}`);
      }
    }
  };
}

async function eventHandler (input) {
      const event = input.event;
      const props = event.properties || {};
      //debugLog(`[verbose] Event: ${JSON.stringify(event)}`);
      if (event.type === "server.instance.disposed") {
        debugLog("server.instance.disposed fired");
        
        for (const state of activeSessions.values()) {
          state.finalizeSession();
        }
        
        activeSessions.clear();
        debugLog("All sessions cleaned up");
        return;
      }

      if (event.type === "global.disposed") {
        debugLog("global.disposed fired");
        return;
      }

      let sessionID = props.sessionID;
      if (!sessionID && props.part?.sessionID) {
        sessionID = props.part.sessionID;
      } else if (!sessionID) {
        if (props.info?.id?.startsWith("ses_")) {
          sessionID = props.info.id;
        } else if (props.info?.sessionID) {
          sessionID = props.info.sessionID;
        }
      }

      if (!sessionID) return;

      if (event.type === "session.created" || event.type === "session.updated") {
        const info = props.info;
        debugLog(`session.created/updated: id=${info?.id}, title=${info?.title}, time=${info?.time?.created}`);
        if (!info || !info.id) return;

        const state = SessionState.createOrRestore(sessionID, info, ctx);

        if (state.title && state.title !== info.title) {
          state.title = info.title;
        }
        return;
      }

      if (event.type === "message.updated") {
        const info = props.info;
        debugLog(`message.updated: id=${info?.id}, role=${info?.role}, title=${info?.title}`);
        if (!info || info.role === "system") return;

        let state = getSession(sessionID);
        if (!state) {
          debugLog(`message.updated: no state found, calling createOrRestore for ${sessionID}`);
          state = SessionState.createOrRestore(sessionID, info);
        }

        if (state.processedMessages.has(info.id)) {
          debugLog(`msg.upd: ${info.role} ${info.id} - SKIP (already processed)`);
          return;
        }
        state.processedMessages.add(info.id);
        const timestamp = new Date(info.time?.created || Date.now()).toISOString();

        if (info.role === "user") {
          log(`\n### User (${timestamp})\n\n`, state.logFile, `msg.updated:${info.role}:${info.id}`);
        } else if (info.role === "assistant") {
          log(`\n### Assistant (${timestamp})\n\n`, state.logFile, `msg.updated:${info.role}:${info.id}`);
        }
        return;
      }

      if (event.type === "message.part.delta") {
        const { messageID, field, delta, partID } = props;
        debugLog(`delta: msgID=${messageID}, field=${field}, deltaLen=${delta?.length}, partID=${partID}`);
        if (field !== "text" || !delta) return;

        const state = getSession(sessionID);
        if (!state) return;

        if (partID && state.reasoningPartIDs.has(partID)) {
          if (!state.isReasoning) {
            state.isReasoning = true;
            log(`\n> *Thinking...* `, state.logFile);
          }
          log(delta, state.logFile, `[reasoning.delta]`);
          return;
        }

        if (state.isReasoning) {
          state.isReasoning = false;
          log(`\n`, state.logFile, `[isResoning:true->false]`);
        }

        if (delta.length === 0) {
          return;
        }
        if (state.loggedDeltas.has(messageID)) {
          return;
        }
        state.loggedDeltas.add(messageID);
        log(delta, state.logFile, `delta:${messageID}`);
        return;
      }

      if (event.type === "message.part.updated") {
        const part = props.part;
        if (!part) return;

        const state = getSession(sessionID);
        if (!state) return;

        if (part.type === "reasoning") {
          if (part.id) {
            state.reasoningPartIDs.add(part.id);
            debugLog(`Registered reasoning part: ${part.id}`);
          }
          return;
        }

        if (state.isReasoning && part.type !== "reasoning") {
          state.isReasoning = false;
        }

        if (part.type === "text") {
          if (part.text) {
            log(part.text, state.logFile);
          }
        } else if (part.type === "snapshot") {
          if (part.snapshot) {
            log(`\n#### Snapshot\n\`\`\`diff\n${part.snapshot}\n\`\`\`\n`, state.logFile);
          }
        } else if (part.type === "patch") {
          debugLog(`patch: files=${JSON.stringify(part.files)}`);
          if (part.files && part.files.length) {
            const shortFiles = part.files.map(f => path.basename(f)).join(", ");
            log(`\n> **Patch:** ${shortFiles}\n`, state.logFile);
          }
        } else if (part.type === "tool") {
          const toolName = part.tool || "unknown";
          const status = part.state?.status || "";
          const toolKey = part.id || `${sessionID}-${toolName}`;

          if (status === "completed" || status === "error") {
            if (!state.processedTools.has(toolKey)) {
              state.processedTools.add(toolKey);
            }
            let targetInfo = "";
            const input = part.state?.input;
            if (typeof input === "object") {
              if (input.filePath) targetInfo = ` ${input.filePath}`;
              else if (input.command) targetInfo = ` \`${input.command}\``;
            }
            log(`\n#### ${toolName}${targetInfo} [${status}]\n`, state.logFile, `tool:${status}:${toolName}`);
            const meta = part.state?.metadata;
            if (meta?.diff) {
              log(`\n\`\`\`diff\n${meta.diff}\n\`\`\`\n`, state.logFile, `tool:diff:${toolName}`);
            }
            if (meta?.output || meta?.result || meta?.preview) {
              const content = meta.output || meta.result || meta.preview || "";
              if (typeof content === "string" && content.trim()) {
                log(`\n\`\`\`\n${content}\n\`\`\`\n`, state.logFile);
              }
            }
          } else if (status === "rejected") {
            if (state.processedTools.has(toolKey)) return;
            state.processedTools.add(toolKey);
            let targetInfo = "";
            const input = part.state?.input;
            if (typeof input === "object") {
              if (input.filePath) targetInfo = ` ${input.filePath}`;
              else if (input.command) targetInfo = ` \`${input.command}\``;
            }
            log(`\n#### ${toolName}${targetInfo} [rejected]\n`, state.logFile);
          } else if (status === "pending" && part.state?.input) {
            if (state.processedTools.has(toolKey)) {
              debugLog(`tool ${toolKey} pending but already processed, skipping`);
            } else {
              state.processedTools.add(toolKey);
              let targetInfo = "";
              const input = part.state.input;
              if (typeof input === "object") {
                if (input.filePath) targetInfo = ` ${input.filePath}`;
                else if (input.command) targetInfo = ` \`${input.command}\``;
              }
              log(`\n#### ${toolName}${targetInfo} [pending]\n`, state.logFile);
              let inputStr = "";
              if (typeof part.state.input === "object") {
                if (part.state.input.command) {
                  inputStr = part.state.input.command;
                } else if (part.state.input.filePath) {
                  inputStr = part.state.input.filePath;
                } else {
                  const keys = Object.keys(part.state.input);
                  if (keys.length > 0) {
                    inputStr = JSON.stringify(part.state.input, null, 2).slice(0, 2000);
                  }
                }
              } else if (part.state.input) {
                inputStr = String(part.state.input);
              }
              if (inputStr) {
                log(`\n\`\`\`\n${inputStr}\n\`\`\`\n`, state.logFile);
              }
            }
          }
        }
        return;
      }

      if (event.type === "tool.execute.after") {
        const state = getSession(sessionID);
        if (!state) return;

        const result = (props.result || "").trim();
        if (!result) return;

        const toolKey = `result-${props.callID || props.tool}`;
        if (state.processedTools.has(toolKey)) return;
        state.processedTools.add(toolKey);

        log(`\n\`\`\`\n${result}\n\`\`\`\n`, state.logFile);
        flushLog(state.logFile);
        return;
      }

      if (event.type === "session.diff") {
        const state = getSession(sessionID);
        if (state) {
          state.lastDiff = props.diff || [];
        }
        return;
      }

      if (event.type === "file.edited") {
        const state = getSession(sessionID);
        if (!state) return;

        debugLog(`file.edited: ${JSON.stringify(props)}`);
        const { file } = props;
        log(`\n> **[Edit] ${file}**\n`, state.logFile);
        return;
      }

      if (event.type === "session.next.reasoning.started") {
        const state = getSession(sessionID);
        if (!state) return;

        state.isReasoning = true;
        log(`\n> *Thinking... `, state.logFile);
        return;
      }

      if (event.type === "session.next.reasoning.delta") {
        const state = getSession(sessionID);
        if (!state || !state.isReasoning) return;
        log(props.delta, state.logFile);
        return;
      }

      if (event.type === "session.next.reasoning.ended") {
        const state = getSession(sessionID);
        if (!state || !state.isReasoning) return;
        log(`\n`, state.logFile, `[reasoning.ended]`);
        state.isReasoning = false;
        return;
      }

      if (event.type === "command.executed") {
        const state = getSession(sessionID);
        if (!state) return;

        const { name, arguments: args } = props;
        const cmdStr = args ? `/${name} ${args}` : `/${name}`;
        log(`\n> \`${cmdStr}\`\n`, state.logFile);
        return;
      }

      if (event.type === "session.next.prompted") {
        const state = getSession(sessionID);
        if (!state) return;

        const { prompt } = props;
        const timestamp = new Date(props.timestamp || Date.now()).toISOString();

        if (prompt && prompt.text) {
          log(`\n### User (${timestamp})\n\n${prompt.text}\n`, state.logFile);
        }
        return;
      }

      if (event.type === "permission.asked") {
        const state = getSession(sessionID);
        if (!state) return;

        debugLog(`permission.asked: ${JSON.stringify(props)}`);
        const { permission, patterns, command, tool } = props;
        state.lastPermission = { permission, patterns, command, tool };

        const cmdKey = command || patterns?.join(",") || permission;
        const permKey = `${cmdKey}-ask`;

        if (state.processedPermissions.has(permKey)) return;
        state.processedPermissions.add(permKey);

        let msg = `> **[Permission]** ${permission}`;
        if (command) {
          msg += `: \`${command}\``;
        } else if (patterns && patterns.length) {
          msg += `: \`${patterns.join("`, `")}\``;
        }
        if (props.metadata?.diff) {
          msg += `\n\`\`\`diff\n${props.metadata.diff}\n\`\`\`\n`;
        } else {
          msg += "\n";
        }
        log(msg, state.logFile, `[permission.asked.msg]`);
        return;
      }

      if (event.type === "permission.replied") {
        const state = getSession(sessionID);
        if (!state) return;

        const { reply } = props;
        
        let context = "";
        if (state.lastPermission && (reply === "reject" || reply === "always" || reply === "once")) {
          context = state.lastPermission.command || state.lastPermission.patterns?.join(", ") || state.lastPermission.permission;
        }
        
        const permKey = `reply-${state.processedPermissions.size}`;
        if (state.processedPermissions.has(permKey)) return;
        state.processedPermissions.add(permKey);

        let msg = `> **[${reply}]**`;
        if (reply === "reject" && context) {
          msg += ` (${context})`;
        }
        msg += "\n";
        log(msg, state.logFile);
        return;
      }
}