# Session Logger Plugin

This is an **opencode plugin** that logs chat history to markdown files. Not a typical Node.js project—it must be copied into user's `.opencode/plugins/` directory.

## Key Files

- `.opencode/plugins/session-logger.js` — Main plugin
- `.opencode/opencode.json` — opencode config with plugin entry
- `.opencode/session-logger.json` — Plugin settings (optional)
- `README.md` — Full documentation

## Commands

None. No build/test/lint/typecheck scripts—this is a plugin distribution, not an application.

## Installation (for users of this plugin)

1. Copy `session-logger.js` to project's `.opencode/plugins/`
2. Add to `.opencode/opencode.json`: `"plugin": [".opencode/plugins/session-logger.js"]`
3. Create `sessions/` directory (required—plugin is no-op if missing)
4. Optional: add `.opencode/session-logger.json` with `{"sessionsDir": "sessions", "debug": false}`

## Development

- Edit `.opencode/plugins/session-logger.js` directly
- No build step needed—edit and test in a project that uses the plugin
- Debug: set `OPENCODE_LOGGER_DEBUG=1` env var or `"debug": true` in config
- Debug output goes to `<sessionsDir>/debug.log`

## Architecture Notes

- Plugin uses `@opencode-ai/plugin` v1.4.6 API (from `.opencode/package.json`)
- Config precedence: env var > config file > defaults
- Session logs named `YYYYMMDD-HHMM-sessionId-title.md`