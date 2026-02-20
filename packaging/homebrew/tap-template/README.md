# Homebrew Tap Template

This directory is a template for a dedicated Homebrew tap repository.

## Recommended tap repository layout

```text
homebrew-tap/
  Formula/
    pb.rb
  README.md
```

## Release flow

1. Publish npm package:

```bash
npm publish
```

2. Update formula url + sha256 in this repository:

```bash
npm run release:homebrew
```

3. Sync formula into tap template:

```bash
npm run release:homebrew:sync
```

4. Copy `tap-template/Formula/pb.rb` to your tap repository and commit.
