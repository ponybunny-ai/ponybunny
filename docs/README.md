# PonyBunny Documentation

Complete documentation for the PonyBunny Autonomous AI Employee System.

## Documentation Structure

### 📖 User Guides (`guides/`)
User-facing documentation and getting started guides:
- **QUICK_START.md** - Quick start guide for new users
- **ANTIGRAVITY_AUTH.md** - Google Antigravity authentication setup

### 💻 CLI Documentation (`cli/`)
Command-line interface documentation:
- **CLI-USAGE.md** - Complete CLI reference (985 lines)
- **README.md** - CLI documentation index
- **SCHEDULER-BACKGROUND-MODE.md** - Background mode implementation
- **BUG-FIX-SERVICE-START-ALL.md** - Service command fixes
- **BUG-FIX-DEBUG-SERVER-NOT-FOUND.md** - Debug server fixes
- **QUICK-REFERENCE.md** - Quick reference card
- **SERVICE-MANAGEMENT-IMPLEMENTATION.md** - Service management details

### 🔧 Development (`development/`)
Developer documentation and guides:
- **AGENTS.md** - Development patterns and testing guidelines
- **TEST_GUIDE.md** - Testing guide and best practices

### 🧩 Implementation Notes (`implementation/`)
Feature-specific implementation guides:
- **gateway-system-status.md** - Gateway system status details
- **scheduler-capabilities-feature.md** - Scheduler capabilities feature
- **web-system-status.md** - Web UI system status
- **streaming/** - LLM streaming implementation and fixes

### 🔌 Integrations & Feature Docs (`openai-compatible/`, `mcp/`)
- **openai-compatible/** - OpenAI-compatible endpoint quickstart, changelog, checklists
- **mcp/** - Model Context Protocol docs (user guides, technical notes, reports)

### 🚚 Delivery & Handoff (`delivery/`)
- **final-delivery.md** - Final cleanup and handoff steps

### 🏗️ Technical Specifications (`techspec/`)
System architecture and design documents:
- **architecture-overview.md** - System architecture diagram and overview
- **gateway-design.md** - WebSocket protocol, authentication, message routing
- **scheduler-design.md** - Task orchestration, model selection, execution lanes
- **ai-employee-paradigm.md** - Responsibility layers, escalation philosophy

### 📋 Requirements (`requirement/`)
Product requirements and specifications

### 🔬 Engineering (`engineering/`)
Engineering reference materials and architecture studies

### 📦 Archive (`archive/`)
Historical documentation and session summaries:
- **IMPLEMENTATION_COMPLETE.md** - Implementation completion summary
- **IMPLEMENTATION_SUMMARY.md** - Implementation summary
- **sessions/** - Session summaries and development logs

## Quick Links

### Getting Started
- [Quick Start Guide](./guides/QUICK_START.md)
- [CLI Usage Guide](./cli/CLI-USAGE.md)
- [Authentication Setup](./guides/ANTIGRAVITY_AUTH.md)

### Development
- [Development Patterns](./development/AGENTS.md)
- [Testing Guide](./development/TEST_GUIDE.md)

### Architecture
- [System Architecture](./techspec/architecture-overview.md)
- [Gateway Design](./techspec/gateway-design.md)
- [Scheduler Design](./techspec/scheduler-design.md)

### Integrations & Features
- [MCP Documentation](./mcp/README.md)
- [OpenAI-Compatible Index](./openai-compatible/INDEX.md)
- [Streaming Implementation](./implementation/streaming/implementation.md)

### CLI Reference
- [Complete CLI Reference](./cli/CLI-USAGE.md)
- [Service Management](./cli/SERVICE-MANAGEMENT-IMPLEMENTATION.md)
- [Scheduler Background Mode](./cli/SCHEDULER-BACKGROUND-MODE.md)

## Project Root Entry Points

Key entry points in the project root:
- **README.md** - Project overview and quick start
- **AGENTS.md** - Pointer to development guide
- **CLAUDE.md** - Pointer to AI assistant instructions

## Contributing

When adding new documentation:
1. Place user guides in `guides/`
2. Place CLI documentation in `cli/`
3. Place development guides in `development/`
4. Place implementation notes in `implementation/`
5. Place integrations in `openai-compatible/` or `mcp/`
6. Place delivery notes in `delivery/`
7. Place technical specs in `techspec/`
8. Archive old documentation in `archive/`

Keep documentation up-to-date with code changes and follow the existing structure.
