# IrrigIQ Cryptographic Key Generation & Rotation Plan

## 1. Key Generation Requirements

### Primary Encryption Key (`CHAT_ENCRYPTION_KEY`)
- **Algorithm**: AES-256-GCM (Authenticated Encryption with Associated Data).
- **Key Length**: Exactly 32 bytes (256 bits), represented as a 64-character hexadecimal string.
- **Rule**: Must be generated using a cryptographically secure pseudo-random number generator (CSPRNG). **Never derive keys from short phrases, human-chosen passwords, or predictable seeds.**
- **Generation Command**:
  ```bash
  # Recommended generation command:
  openssl rand -hex 32
  # Or via Node.js crypto CSPRNG:
  node -e "console.log(crypto.randomBytes(32).toString('hex'))"
  ```
- **Storage**: Injected as an environment variable via AWS Secrets Manager, GCP Secret Manager, or Doppler. Never committed to source control or logged in plaintext.

### Blind Index Key (`CHAT_INDEX_KEY`)
- **Algorithm**: HMAC-SHA256.
- **Purpose**: Creates deterministic search tokens for channel identification (`externalIdHash`) without exposing identifiers to frequency analysis or dictionary rainbow table attacks.
- **Key Separation**: Must use a secret distinct from `CHAT_ENCRYPTION_KEY` to guarantee defense-in-depth: compromising the blind index key does not permit decrypting payloads, and vice versa.
- **Generation Command**:
  ```bash
  openssl rand -hex 32
  ```

---

## 2. Key Rotation Procedure

To rotate cryptographic keys without application downtime or data loss:

### Step 1: Provision Candidate Key
Generate the new key and stage it in the deployment environment:
```bash
NEW_ENC_KEY=$(openssl rand -hex 32)
NEW_INDEX_KEY=$(openssl rand -hex 32)
```
Add `CHAT_ENCRYPTION_KEY_NEXT=$NEW_ENC_KEY` and `CHAT_INDEX_KEY_NEXT=$NEW_INDEX_KEY` to secrets.

### Step 2: Run Idempotent Re-Encryption & Index Migration
Run the migration script to re-encrypt records and update blind indexes:
```bash
# 1. Preview changes safely:
npm run migrate:blind-index -- --dry-run

# 2. Execute atomic migration in batches:
npm run migrate:blind-index
```
The migration script:
1. Decrypts `externalIdEncrypted` using the current `CHAT_ENCRYPTION_KEY`.
2. Re-encrypts with `CHAT_ENCRYPTION_KEY_NEXT` using a fresh 96-bit random IV and captures the new 128-bit authentication tag.
3. Computes the updated blind index using `CHAT_INDEX_KEY_NEXT`.
4. Saves the document. If interrupted, the migration is idempotent and can be safely re-run.

### Step 3: Promote New Keys
1. Update `CHAT_ENCRYPTION_KEY` to the value of `CHAT_ENCRYPTION_KEY_NEXT`.
2. Update `CHAT_INDEX_KEY` to the value of `CHAT_INDEX_KEY_NEXT`.
3. Unset the `*_NEXT` variables and deploy the application.
4. Verify channel lookup and message delivery with `npm run test`.

