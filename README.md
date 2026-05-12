# Session Logger Plugin

A plugin for [opencode](https://opencode.ai) that saves chat history to markdown files, preserving the chain of events after session compaction or restarts.

## Features

- **Per-session state management** - Each session has independent state with deduplication
- **Clean markdown output** - Human-readable session logs
- **Captures:**
  - User and assistant messages with timestamps
  - Tool execution results (read, bash, edit, etc.)
  - File changes with diffs
  - Permissions (approve/reject) with context
  - Reasoning/thinking sections
  - Patch notifications for changed files
- **Session title tracking** - Filename updates when title changes
- **Exit summary** - Changed files list on session end
- **Multi-session support** - Works across day boundaries

## Installation

### 1. Copy plugin files

**Option A: Project-specific (recommended for project-specific sessions)**

Copy `session-logger.js` to your project's `.opencode/plugins/` directory:

```bash
mkdir -p .opencode/plugins
# Copy session-logger.js to .opencode/plugins/
```

**Option B: Global (for all opencode sessions)**

Copy to your home directory:

```bash
mkdir -p ~/.opencode/plugins
cp session-logger.js ~/.opencode/plugins/
```

**Merging existing `.opencode` directories:**

If you already have an `.opencode` directory with existing configuration:

1. Copy `session-logger.js` to `.opencode/plugins/`
2. Add plugin entry to existing `.opencode/opencode.json` (see step 2 below)
### 3. Enable plugin in opencode config

Add to `.opencode/opencode.json`:

```json
{
  "plugin": [".opencode/plugins/session-logger.js"]
}
```

### 4. Create sessions directory

The plugin requires a directory to store session logs:

```bash
mkdir sessions
```

### 5. Configure (optional)

Create `.opencode/session-logger.json` in your project:

```json
{
  "sessionsDir": "sessions",
  "debug": false
}
```

## Configuration

### Config File (`.opencode/session-logger.json`)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `sessionsDir` | string | `"sessions"` | Directory for session log files |
| `debug` | boolean | `false` | Enable debug logging |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENCODE_SESSION_DIR` | Override sessions directory |
| `OPENCODE_LOGGER_DEBUG` | Set to `"1"` to enable debug logging |

### Configuration Precedence

1. Environment variable (highest)
2. Config file
3. Default value (lowest)

## Log Format

Session logs are stored as markdown files with this naming convention:

```
YYYYMMDD-HHMM-sessionId-title.md
```

Example: `20260512-1430-ses_abc123-Session-title.md`

### Session Header

```markdown
---
## Session: ses_abc123
### Title: My Session
Started: 2026-05-12T14:30:00.000Z
Directory: /path/to/project
---

## Chat History
```

### Message Types

**User message:**
```markdown
### User (2026-05-12T14:30:05.123Z)

User's message content here
```

**Assistant message:**
```markdown
### Assistant (2026-05-12T14:30:10.456Z)

Assistant's response with reasoning and actions
```

### Tool Execution

**Bash command:**
```markdown
#### bash `pwd` [completed]
```
/home/user/project

```

**Read file:**
```markdown
#### read /path/to/file.txt [completed]
```
File content here...

```

**Edit file:**
```markdown
#### edit /path/to/file.txt [completed]
```diff
--- file.txt
+++ file.txt
@@ -1,3 +1,3 @@
-old content
+new content
```

**Rejected edit:**
```markdown
#### edit /path/to/file.txt [rejected]
```

### Permissions

**Permission request:**
```markdown
> **[Permission]** edit: `test.txt`
```diff
--- test.txt
+++ test.txt
@@ -1 +1 @@
-old
+new

```

**Permission response:**
```markdown
> **[once]**
> **[reject]** (test.txt)
```

### Reasoning/Thinking

```markdown
> *Thinking...*
Internal reasoning text here...

```

### File Changes

**Patch notification:**
```markdown
> **Patch:** file1.txt, file2.txt
```

### Session End

```markdown
> --- Session ended 2026-05-12T15:00:00.000Z ---

> Changed files:
>   M file1.txt (+5/-2)
>   A newfile.txt
>   D deleted.txt
```

## Known Limitations

1. **`session.diff` events** - May return empty array; plugin relies on `patch` events for file change tracking
2. **`file.edited` events** - Do not include `sessionID`; cannot associate with active session
3. **External file changes** - Not all external file modifications trigger patch notifications
4. **Session directory required** - Plugin returns no-op if sessions directory doesn't exist

## Debugging

Enable debug logging for troubleshooting:

```bash
# Via environment variable
export OPENCODE_LOGGER_DEBUG=1

# Or in config file
{
  "sessionsDir": "sessions",
  "debug": true
}
```

Debug output is written to `<sessionsDir>/debug.log` when enabled.

## File Structure

```
project/
├── .opencode/
│   ├── opencode.json           # Plugin configuration
│   ├── session-logger.json      # Plugin settings (optional)
│   └── plugins/
│       └── session-logger.js   # The plugin
├── sessions/                    # Session logs directory
│   ├── debug.log               # Debug output (when enabled)
│   └── YYYYMMDD-HHMM-*.md    # Session log files
```

## License

MIT
