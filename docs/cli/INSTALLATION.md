# Installation

## npm (no clone required)

```bash
npm install -g ponybunny
pb init
```

- Global install exposes `pb` on PATH via npm's global bin directory.
- Config files are created under `~/.config/ponybunny`.
- Runtime/install assets are placed under `~/.ponybunny`.

## Homebrew (no clone required)

```bash
brew tap <your-org>/tap
brew install pb
pb init
```

Formula template lives at `packaging/homebrew/pb.rb`.
Tap repository template lives at `packaging/homebrew/tap-template`.

## Maintainer release flow

1. Publish package to npm:

```bash
npm publish
```

2. Update Homebrew formula automatically from npm version:

```bash
npm run release:homebrew
```

3. Sync formula into tap template:

```bash
npm run release:homebrew:sync
```

4. Commit `packaging/homebrew/tap-template/Formula/pb.rb` to your Homebrew tap repository.

## Maintainer verification checklist

After updating formula assets, run:

```bash
npm run build:cli
npm pack --dry-run
node dist/cli/index.js --help
node dist/cli/index.js install --dry-run
```

Then verify Homebrew formula in tap repository:

```bash
brew install --formula ./Formula/pb.rb
pb --help
pb init --dry-run
```

## Formula script options

You can also run the updater script directly:

```bash
node scripts/release/update-homebrew-formula.mjs --version 1.2.3 --package ponybunny
```

Optional flags:
- `--formula <path>` formula file path (default `packaging/homebrew/pb.rb`)
- `--sha256 <hex>` skip network download and force checksum
- `--dry-run` print values without writing files
