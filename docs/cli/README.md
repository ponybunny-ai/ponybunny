# PonyBunny CLI Documentation

This directory contains documentation for the PonyBunny command-line interface (`pb`).

## Documentation Files

- **[CLI-USAGE.md](./CLI-USAGE.md)** - Complete CLI reference guide
  - Installation and quick start
  - All commands with examples
  - Configuration management
  - Service management
  - Troubleshooting
- **[INSTALLATION.md](./INSTALLATION.md)** - npm/Homebrew installation and maintainer release steps

## Quick Links

### Getting Started
- [Installation](./CLI-USAGE.md#installation)
- [npm/Homebrew Installation](./INSTALLATION.md)
- [Quick Start](./CLI-USAGE.md#quick-start)
- [Authentication](./CLI-USAGE.md#authentication)

### Common Tasks
- [Service Management](./CLI-USAGE.md#service-management)
- [Debug & Observability](./CLI-USAGE.md#debug--observability)
- [Work Execution](./CLI-USAGE.md#work-execution)

### Reference
- [Commands Overview](./CLI-USAGE.md#commands-overview)
- [Environment Variables](./CLI-USAGE.md#environment-variables)
- [Configuration Files](./CLI-USAGE.md#configuration-files)

## Command Summary

```bash
# Core commands
pb init                    # Initialize configuration
pb status                  # Check system status
pb auth login              # Authenticate
pb service start all       # Start all services
pb debug web               # Launch debug UI
pb work "task"             # Execute autonomous task

# Service management
pb service status          # Check all services
pb service start <name>    # Start a service
pb service stop <name>     # Stop a service
pb service logs <name>     # View logs

# Gateway management
pb gateway start           # Start Gateway server
pb gateway status          # Check Gateway status
pb gateway pair            # Create pairing token

# Model management
pb models list             # List cached models
pb models refresh          # Refresh from APIs

# Authentication
pb auth list               # List accounts
pb auth switch <id>        # Switch account
pb auth set-strategy <s>   # Set load balancing
```

## Architecture

The PonyBunny CLI is built with:
- **Commander.js** - Command-line argument parsing
- **Chalk** - Terminal styling
- **Ora** - Spinners and progress indicators
- **Inquirer** - Interactive prompts
- **Ink** - React-based terminal UI components

## Related Documentation

- [Architecture Overview](../techspec/architecture-overview.md)
- [Gateway Design](../techspec/gateway-design.md)
- [Scheduler Design](../techspec/scheduler-design.md)
- [Development Guidelines](../../CLAUDE.md)

## Support

For issues or questions:
- GitHub Issues: https://github.com/anthropics/claude-code/issues
- Run `pb --help` for inline help
