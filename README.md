# TabTamer

A Firefox extension that auto-groups new tabs using LLM-powered classification.

## Prerequisites

- **Firefox 85+** (required for `tabs.group()` API support)
- **API key** from [opencode.ai](https://opencode.ai/) (set in the extension options page under "API Key")

## Quick Start

1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Select the `extension/manifest.json` file

The extension will be loaded until Firefox is restarted.

## Build

See [BUILD.md](./BUILD.md) for detailed build instructions, including dependency installation and packaging.

## Testing

See [TESTING.md](./TESTING.md) for testing guidelines, test runner setup, and test suite structure.

## License

This project is licensed under the [MIT License](./LICENSE).
