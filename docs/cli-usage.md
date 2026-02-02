# PonyBunny CLI (`pb`)

Command-line interface for PonyBunny autonomous AI employee system.

## Installation

```bash
npm install -g pony
```

Or link locally for development:

```bash
git clone https://github.com/ponybunny-ai/ponybunny.git
cd ponybunny
npm install
npm run build:cli
npm link
```

## Quick Start

### 1. Login with OAuth

```bash
pb auth login
```

This will:
- Open your browser for OpenAI OAuth authentication
- Grant access to GPT-5.2 model
- Save authentication token locally

### 2. Chat with GPT-5.2

```bash
pb chat
```

Start an interactive chat session with GPT-5.2 model. Type your messages and get AI responses in real-time.

Options:
- `-m, --model <model>` - Specify model (default: gpt-5.2)
- `-s, --system <message>` - Set system message

### 3. Create Autonomous Goals

```bash
pb goal create
```

Create a new autonomous goal that the AI will work on independently.

### 4. Check Status

```bash
pb status
```

View authentication status and API connection health.

## Commands

### Authentication

```bash
# Login with OAuth
pb auth login [--gateway <url>]

# Show current user
pb auth whoami

# Logout
pb auth logout
```

### Chat

```bash
# Interactive chat (default GPT-5.2)
pb chat

# Specify model
pb chat --model gpt-4o

# Set system message
pb chat --system "You are a helpful coding assistant"
```

### Goals

```bash
# Create new goal
pb goal create

# List all goals
pb goal list

# Show goal details
pb goal show <id>
```

### Configuration

```bash
# Show configuration
pb config show

# Set gateway URL
pb config set-gateway
```

### Status

```bash
# Check authentication and API status
pb status
```

## Architecture

### OAuth Flow

1. User runs `pb auth login`
2. CLI starts local HTTP server on port 8765
3. Opens browser to gateway OAuth page
4. User authorizes with OpenAI account
5. Gateway redirects to `http://localhost:8765/callback?code=...`
6. CLI exchanges code for access token
7. Token saved to `~/.ponybunny/auth.json`

### Gateway Integration

All API calls go through the PonyBunny gateway:

```
pb CLI → Gateway API → OpenAI GPT-5.2
      ↓
   Local Storage (~/.ponybunny/)
```

### Configuration Files

- `~/.ponybunny/auth.json` - Authentication tokens and user info
- `~/.ponybunny/config.json` - CLI preferences (future)

## Development

### Project Structure

```
src/cli/
├── index.ts              # CLI entry point
├── commands/
│   ├── auth.ts          # OAuth login/logout
│   ├── chat.ts          # Interactive chat
│   ├── goal.ts          # Goal management
│   ├── status.ts        # Status check
│   └── config.ts        # Configuration
└── lib/
    ├── auth-manager.ts  # Token storage
    └── gateway-client.ts # API client
```

### Build

```bash
npm run build:cli
```

### Test Locally

```bash
npm link
pb --help
```

## Environment Variables

- `PONYBUNNY_GATEWAY` - Override default gateway URL
- `PONYBUNNY_CONFIG_DIR` - Custom config directory (default: `~/.ponybunny`)

## Examples

### Simple Chat Session

```bash
$ pb chat
🤖 PonyBunny Chat (Model: gpt-5.2)

You: Hello!
Assistant: Hi! How can I help you today?

You: Write a fizzbuzz function
Assistant: Here's a clean FizzBuzz implementation:

function fizzBuzz(n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    const num = i + 1;
    if (num % 15 === 0) return 'FizzBuzz';
    if (num % 3 === 0) return 'Fizz';
    if (num % 5 === 0) return 'Buzz';
    return String(num);
  });
}

You: exit
👋 Goodbye!
```

### Creating an Autonomous Goal

```bash
$ pb goal create
? Goal title: Implement user authentication
? Goal description: (opens editor)
Add JWT-based authentication with:
- Login endpoint
- Logout endpoint
- Protected routes middleware
- Token refresh logic
? Token budget: 100000

✓ Goal created successfully!

Goal ID: goal-abc123
Title: Implement user authentication
Status: queued
```

## Troubleshooting

### Authentication Issues

```bash
# Check current auth status
pb auth whoami

# Re-authenticate
pb auth logout
pb auth login
```

### Gateway Connection Errors

```bash
# Check status
pb status

# Set custom gateway
pb config set-gateway
# Enter: https://your-gateway.com
```

### OAuth Timeout

If OAuth login times out:
1. Make sure port 8765 is not in use
2. Check firewall settings
3. Manually visit the OAuth URL shown in terminal

## License

ISC
