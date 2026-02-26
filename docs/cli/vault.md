Good. Below is a **tight, implementation-ready requirement spec** aligned with your constraints.

---

# PonyBunny CLI Feature Spec

## `pb auth save` / `pb auth load` (Vault Mode)

---

## 1. Purpose

Provide encrypted backup and restore of:

```
~/.config/ponybunny/credentials.json
```

The backup:

* Is encrypted with a user-provided **passkey**
* Is stored in:

  ```
  ~/.config/ponybunny/vault/
  ```
* Uses filename = current date + time
* Restores by fully overwriting `credentials.json` only if passkey is correct

This is a **local-first, private-first** vault mechanism.

---

## 2. File Locations

### Credentials source

```
~/.config/ponybunny/credentials.json
```

### Vault directory

```
~/.config/ponybunny/vault/
```

If the directory does not exist:

* Create it
* Set permission to `0700`

---

## 3. File Naming Convention

### Format

```
YYYYMMDD-HHMMSS.pbvault
```

Example:

```
20260226-112530.pbvault
```

Extension chosen:
**`.pbvault`**

Reason:

* Explicit
* Human recognisable
* PonyBunny-specific
* Not generic like `.enc`

---

## 4. Command Definitions

---

# 4.1 `pb auth save`

### Behaviour

1. Verify `credentials.json` exists
2. Prompt:

   ```
   Enter passkey:
   Confirm passkey:
   ```
3. Read full contents of:

   ```
   credentials.json
   ```
4. Encrypt content using passkey
5. Save encrypted file into:

   ```
   ~/.config/ponybunny/vault/YYYYMMDD-HHMMSS.pbvault
   ```
6. Set file permission to `0600`
7. Print:

   ```
   ✔ Credentials encrypted and saved
   Vault file: ~/.config/ponybunny/vault/20260226-112530.pbvault
   ```

---

### Encryption Requirements (Mandatory)

* Use **authenticated encryption (AEAD)**
* Must include:

  * Random salt
  * Strong KDF (memory hard)
  * Random nonce
  * Integrity protection

### Recommended stack (TypeScript ecosystem friendly)

* KDF: Argon2id
* Cipher: AES-256-GCM OR XChaCha20-Poly1305
* Random 16–32 byte salt
* Random 12–24 byte nonce

---

## Vault File Format (v1)

Binary format:

```
[ MAGIC 8 bytes ]
[ VERSION 1 byte ]
[ SALT length + SALT ]
[ NONCE length + NONCE ]
[ CIPHERTEXT length + DATA ]
```

Magic header:

```
PBVAULT1
```

No plaintext JSON must exist in file.

---


# 4.2 `pb auth load [file]` 

---

## 4.2.1 Command Signature

```
pb auth load [vault-file]
```

### Behaviour Split

| Mode                  | Trigger                     |
| --------------------- | --------------------------- |
| Direct Load           | `<vault-file>` provided     |
| Interactive Selection | `<vault-file>` NOT provided |

---

# 4.2.2 Interactive Vault Selection 

If user runs:

```
pb auth load
```

### Step 1 — Scan Vault Directory

Directory:

```
~/.config/ponybunny/vault/
```

Rules:

* Only include files ending with `.pbvault`
* Ignore hidden files
* Ignore corrupted filenames
* If directory missing → show:

  ```
  No vault directory found.
  ```
* If no vault files found → show:

  ```
  No vault backups available.
  ```

---

### Step 2 — Sort Order

Sort files:

```
Newest → Oldest
```

Based on:

* Timestamp parsed from filename
* Fallback: filesystem mtime

---

### Step 3 — Interactive Selection UI

Display interactive list:

```
Select a vault backup:

> 20260226-112530.pbvault
  20260220-091112.pbvault
  20260215-184422.pbvault
```

Controls:

| Key          | Behaviour         |
| ------------ | ----------------- |
| ↑ / ↓        | Move selection    |
| Enter        | Confirm selection |
| Esc / Ctrl+C | Cancel operation  |

If cancelled:

```
Operation cancelled.
```

Exit cleanly.

---

### Step 4 — After Selection

Once user selects a file:

Continue with standard flow:

1. Prompt for passkey
2. Attempt decryption
3. If failure → abort safely
4. If success → overwrite credentials.json (with backup)

---

# 4.2.3 Direct File Mode 

If user runs:

```
pb auth load 20260226-112530.pbvault
```

Then:

* Skip interactive selection
* Validate file exists
* Continue to passkey prompt

---

# 4.2.4 Security Rules 

* Never display decrypted content
* Never preview JSON
* Never partially write credentials.json
* Wrong passkey must not modify filesystem
* Always validate header + version

---

# 4.2.5 Edge Cases

| Case                              | Behaviour          |
| --------------------------------- | ------------------ |
| Vault directory missing           | Inform user        |
| Empty directory                   | Inform user        |
| Corrupted file in list            | Skip silently      |
| Selected file deleted mid-process | Abort with message |
| Wrong passkey                     | Abort safely       |

---

# 4.2.6 UX Enhancements (Optional but Recommended)

When listing files, show relative age:

```
> 20260226-112530.pbvault  (Today)
  20260220-091112.pbvault  (6 days ago)
  20260215-184422.pbvault  (11 days ago)
```

---

# 4.2.7 CLI Help Update

### `pb auth load -h`

```
Restore credentials from encrypted PonyBunny vault file.

Usage:
  pb auth load <vault-file>
  pb auth load   (interactive selection)

If no file is specified, an interactive vault selector will appear.
Will overwrite:
  ~/.config/ponybunny/credentials.json
Requires correct passkey.
```

---

## Atomic Safety Rule

Overwrite must happen only after:

* Successful decrypt
* Valid JSON parse
* Schema validation

If write fails:

* Restore from `.bak`

---

## 5. Security Requirements

### 5.1 Passkey Handling

* Never log passkey
* Never store passkey
* Use hidden terminal input
* Clear passkey buffer from memory after use

---

### 5.2 Tamper Detection

If:

* Header mismatch
* Decryption authentication fails
* Truncated data

→ Abort immediately

---

### 5.3 Permissions

| File             | Permission |
| ---------------- | ---------- |
| vault directory  | 0700       |
| vault file       | 0600       |
| credentials.json | 0600       |

---

## 6. Failure Cases

| Case                       | Behaviour       |
| -------------------------- | --------------- |
| credentials.json missing   | Error + exit    |
| vault file missing         | Error + exit    |
| wrong passkey              | Abort, no write |
| corrupted file             | Abort           |
| invalid JSON after decrypt | Abort           |

---

## 7. Minimal CLI Help

### `pb auth save -h`

```
Encrypt and backup credentials.json into PonyBunny vault.

Usage:
  pb auth save

Stores encrypted file at:
  ~/.config/ponybunny/vault/

Requires passkey input.
```

---

### `pb auth load -h`

```
Restore credentials from encrypted PonyBunny vault file.

Usage:
  pb auth load <vault-file>

Will overwrite:
  ~/.config/ponybunny/credentials.json

Requires correct passkey.
```

---

## 8. Acceptance Criteria

* No plaintext secret appears in vault file
* Wrong passkey never modifies credentials.json
* Vault file created with correct timestamp format
* Cross-machine restore works
* File tampering detected
* Permissions enforced

