# MCP Generic Connection Manager — Implementation Plan

## Status: PLANNING

## Goal

Build a generic MCP connection manager that lets Taylor users add any MCP server and authenticate with their own credentials. Treat this as a **security-sensitive user-managed integration system**, not just a connection wrapper.

## Architecture Decisions

- **Built-in adapters (LinkedIn, Exa, GitHub) stay separate.** They do NOT use MCPServer/MCPCredential tables. No unification.
- **Keep string PKs** (`mcp_xxx`, `cred_xxx`). No UUID migration needed.
- **Keep health fields on MCPServer.** No separate health table.
- **Keep `display_name`** on MCPServer.
- **Keep `tools_json`** as a cache alongside new MCPTool table. Deprecate later.
- **Keep `auth_config`** as migration bridge. Add per-type encrypted fields alongside it. Deprecate later.
- **Keep transport value** as `"streamable-http"` (hyphen). Don't change existing values.

## Target User Flow

```
Settings → MCP Servers → Add MCP Server
  ├── Name
  ├── Server URL
  ├── Transport: HTTP / SSE / Streamable HTTP
  ├── Authentication type
  └── Credentials
        → Test connection
        → Discover available MCP tools
        → Save encrypted credentials
        → Use tools from Taylor Chat
```

## Supported Authentication Modes

1. None
2. API key (configurable header name)
3. Bearer token
4. Basic authentication
5. Custom headers (dynamic key/value rows)
6. OAuth 2.0 (Authorization Code + PKCE)

## Data Model

### MCPServer — ADDITIVE changes only

```python
class MCPServer(Base):
    __tablename__ = "mcp_servers"

    # KEEP existing fields
    server_id: Mapped[str]           # string PK (f"mcp_{uuid4().hex[:12]}")
    name: Mapped[str]
    display_name: Mapped[str | None]
    url: Mapped[str | None]
    transport: Mapped[str]           # keep "streamable-http"
    enabled: Mapped[bool]
    status: Mapped[str]
    error_message: Mapped[str | None]
    tools_json: Mapped[str | None]   # deprecate later
    last_connected_at: Mapped[str | None]
    health_last_success: Mapped[str | None]
    health_last_failure: Mapped[str | None]
    health_consecutive_failures: Mapped[int]
    health_avg_latency_ms: Mapped[float]
    health_total_calls: Mapped[int]
    health_success_calls: Mapped[int]
    created_at: Mapped[str]
    updated_at: Mapped[str]

    # RENAME (additive)
    server_kind: Mapped[str]         # NEW column, default="remote"
    # Values: remote | local_stdio | managed
    # Backfill: server_type="builtin" → server_kind="managed"
    #           server_type="custom"  → server_kind="remote"

    # ADD (additive)
    user_id: Mapped[str | None]      # NEW column, nullable initially
    last_error_code: Mapped[str | None]  # NEW column
```

Every server query must include the current user:

```python
server = await repository.get_by_id_and_user(
    server_id=server_id,
    user_id=current_user.id,
)
```

### MCPCredential — ADDITIVE changes only

```python
class MCPCredential(Base):
    __tablename__ = "mcp_credentials"

    # KEEP existing fields
    credential_id: Mapped[str]       # string PK (f"cred_{uuid4().hex[:12]}")
    server_id: Mapped[str]
    auth_type: Mapped[str]
    auth_config: Mapped[str]         # DEPRECATE after migration, keep for now
    created_at: Mapped[str]
    updated_at: Mapped[str]

    # ADD per-type encrypted fields (additive)
    api_key_header_name: Mapped[str | None]
    encrypted_api_key: Mapped[str | None]
    encrypted_access_token: Mapped[str | None]
    encrypted_refresh_token: Mapped[str | None]
    encrypted_username: Mapped[str | None]
    encrypted_password: Mapped[str | None]
    encrypted_custom_headers: Mapped[str | None]
    oauth_authorization_url: Mapped[str | None]
    oauth_token_url: Mapped[str | None]
    oauth_client_id: Mapped[str | None]
    encrypted_client_secret: Mapped[str | None]
    oauth_scope: Mapped[str | None]
    token_expiry: Mapped[str | None]
    oauth_state_hash: Mapped[str | None]
    oauth_state_expires_at: Mapped[str | None]
```

### MCPTool — new table

```python
class MCPTool(Base):
    __tablename__ = "mcp_tools"

    id: Mapped[str]                  # string PK
    server_id: Mapped[str]           # FK → mcp_servers.server_id
    name: Mapped[str]                # original tool name (e.g., "search_jobs")
    public_name: Mapped[str]         # namespaced (e.g., "my_server__search_jobs")
    description: Mapped[str]
    input_schema: Mapped[str]        # JSON string
    enabled: Mapped[bool]            # default True
    last_discovered_at: Mapped[str | None]

    __table_args__ = (
        UniqueConstraint("server_id", "name", name="uq_mcp_tool_server_name"),
    )
```

### ResolvedMCPCredentials — new dataclass

```python
@dataclass
class ResolvedMCPCredentials:
    auth_type: str
    headers: dict[str, str] = field(default_factory=dict)
    query_params: dict[str, str] = field(default_factory=dict)
```

Connection layer only receives resolved headers. It does not care whether the token came from an API key, OAuth, or an encrypted database field.

## Security Requirements

### SSRF Protection

Because users can enter arbitrary MCP URLs:

1. Resolve DNS and validate the resulting IP before connecting
2. Reject private/internal targets:
   - 127.0.0.1, localhost, 0.0.0.0
   - 169.254.169.254 (cloud metadata)
   - RFC1918 private ranges (10.x, 172.16-31.x, 192.168.x)
   - Internal DNS names
3. Re-check redirects — an allowed public URL must not redirect to an internal address
4. Do not rely only on hostname string matching

### Credential Validation

```python
FORBIDDEN_HEADERS = {
    "host", "content-length", "connection", "transfer-encoding",
}

def validate_credentials(payload: CredentialPayload):
    # Reject CRLF in header names/values
    # Reject empty header names
    # Reject invalid URLs
    # Reject non-HTTP URLs for HTTP transports
    # Reject private/internal targets without SSRF protection
```

### Security Boundaries

- LLM never sees API keys, tokens, passwords, or refresh tokens
- Credentials decrypted only at HTTP transport layer
- User registers and approves MCP server first → Taylor validates → discovers tools → user enables → planner uses only enabled tools
- OAuth tokens encrypted at rest, auto-refreshed transparently
- No secrets in AsyncStorage, LocalStorage, Redux, MMKV, URL params, or analytics

## Backend Architecture

```
app/
├── models.py
├── db_engine.py
├── routers/mcp.py
├── services/mcp/
│   ├── authentication.py      # ResolvedMCPCredentials + MCPAuthenticationService
│   ├── connection.py          # MCPConnectionManager (uses resolved headers)
│   ├── discovery.py           # MCPDiscoveryService (tool discovery + MCPTool persistence)
│   ├── validation.py          # SSRF validation, credential validation
│   ├── errors.py              # MCP-specific exceptions
│   ├── transports/
│   │   ├── base.py            # TransportFactory base class
│   │   ├── streamable_http.py
│   │   └── sse.py
│   └── oauth/
│       ├── client.py          # OAuth token exchange
│       ├── state.py           # State validation
│       └── pkce.py            # PKCE code_verifier/challenge
├── tools/
│   ├── registry.py            # Two-layer: static Taylor + dynamic MCP
│   ├── executor.py            # Secure MCP tool execution
│   └── schemas.py             # ToolDescriptor model
```

## Frontend Architecture

```
components/settings/mcp/
├── mcp-settings.tsx           # Main settings page
├── mcp-server-form.tsx        # Add/edit server dialog
├── auth-type-selector.tsx     # Auth type dropdown
├── credential-fields.tsx      # Discriminated union form
├── custom-headers-editor.tsx  # Dynamic key/value rows
└── oauth-connect-button.tsx   # OAuth popup trigger

lib/api/mcp.ts                 # API client
```

Auth config as discriminated union:

```typescript
type AuthConfig =
  | { authType: "none" }
  | { authType: "api_key"; headerName: string; apiKey: string }
  | { authType: "bearer"; accessToken: string }
  | { authType: "basic"; username: string; password: string }
  | { authType: "custom_headers"; headers: Record<string, string> }
  | { authType: "oauth"; authorizationUrl?: string; tokenUrl?: string;
      clientId: string; clientSecret?: string; scopes: string[] };
```

## API Endpoints

```
POST   /mcp/servers                      # Create server (no secrets)
GET    /mcp/servers                      # List user's servers
GET    /mcp/servers/{id}                 # Get server (ownership enforced)
PATCH  /mcp/servers/{id}                 # Update server
DELETE /mcp/servers/{id}                 # Delete server + credentials

PUT    /mcp/servers/{id}/credentials     # Store/update credentials
GET    /mcp/servers/{id}/credentials     # Get credential metadata (not secrets)
DELETE /mcp/servers/{id}/credentials     # Delete credentials

POST   /mcp/servers/{id}/test            # Test connection
POST   /mcp/servers/{id}/discover        # Discover tools
GET    /mcp/servers/{id}/tools           # List discovered tools
PATCH  /mcp/servers/{id}/tools/{tool_id} # Enable/disable tool

POST   /mcp/servers/{id}/oauth/authorize # Get OAuth authorization URL
POST   /mcp/servers/{id}/oauth/callback  # Exchange code for token
```

## Implementation Milestones

### Milestone 1: Ownership + Static Credentials

1. Add `user_id` and `server_kind` columns to MCPServer (ADDITIVE)
2. Add per-type encrypted columns to MCPCredential (ADDITIVE)
3. Backfill `user_id` from first user, `server_kind` from `server_type`
4. DB migration (ADDITIVE only, no drops)
5. Implement `ResolvedMCPCredentials` + `MCPAuthenticationService`
6. Implement SSRF validation (`validation.py`)
7. Implement credential validation (`CredentialPayload` + rules)
8. Add `PUT /mcp/servers/{id}/credentials` endpoint (separate from server creation)
9. Add `POST /mcp/servers/{id}/test` endpoint
10. Frontend: auth-type-specific credential forms

### Milestone 2: Transports + Discovery

1. Implement transport factory: HTTP, SSE, Streamable HTTP
2. Create `MCPDiscoveryService` with tool persistence to MCPTool table
3. Namespace tools as `server__tool` (double underscore)
4. Add enable/disable controls per tool
5. Add `GET /mcp/servers/{id}/tools` endpoint
6. Frontend: tool list with enable/disable toggles

### Milestone 3: Secure Executor

1. Validate every MCP call: ownership, server enabled, tool enabled, schema validation
2. Per-tool timeout
3. Maximum response size
4. Maximum output tokens sent to LLM
5. Cancellation support
6. Rate limiting
7. Audit logging (no secrets)
8. Retry policy only for safe transient errors (no retries for auth/permission failures)

### Milestone 4: OAuth

1. Implement OAuth metadata storage in MCPCredential
2. Authorization Code + PKCE flow
3. State validation: hash, expiry, user ownership, server ownership, single-use
4. Token exchange with code_verifier
5. Encrypted access/refresh token storage
6. Auto-refresh expired tokens before connecting
7. Reauthorization UI
8. Support both automatic metadata discovery and manual OAuth configuration

### Milestone 5: Tests

1. Integration tests for arbitrary MCP servers
2. Security tests: ownership enforcement, SSRF protection, credential leakage, tool access control
3. Tool collision tests (same name from different servers)
4. OAuth flow tests (state validation, token refresh, expiry)
5. Frontend credential form tests

## Migration Strategy

1. **Phase A**: Add new columns to existing tables (ADDITIVE only, no drops)
2. **Phase B**: Backfill `user_id` on MCPServer from first user
3. **Phase C**: Write to both `auth_config` and per-type columns during credential store
4. **Phase D**: After frontend is updated, stop reading from `auth_config` and `tools_json`
5. **Phase E**: (Future) Drop deprecated columns

## Files to Create/Modify

| File | Milestone | Action |
|------|-----------|--------|
| `app/models.py` | 1 | Modify — add MCPTool, add columns to MCPServer/MCPCredential (ADDITIVE) |
| `app/db_engine.py` | 1 | Modify — migration (ADDITIVE only, no drops) |
| `app/services/mcp/authentication.py` | 1 | Rewrite — ResolvedMCPCredentials + MCPAuthenticationService |
| `app/services/mcp/validation.py` | 1 | Create — SSRF + credential validation |
| `app/services/mcp/errors.py` | 1 | Create — MCP exceptions |
| `app/services/mcp/connection.py` | 2 | Rewrite — transport factory + resolved headers |
| `app/services/mcp/discovery.py` | 2 | Rewrite — MCPDiscoveryService |
| `app/services/mcp/transports/base.py` | 2 | Create — TransportFactory base |
| `app/services/mcp/transports/streamable_http.py` | 2 | Create |
| `app/services/mcp/transports/sse.py` | 2 | Create |
| `app/routers/mcp.py` | 1+2+4 | Modify — add test, tools, OAuth endpoints (ADDITIVE) |
| `app/tools/registry.py` | 2+3 | Modify — two-layer registry + namespace |
| `app/tools/executor.py` | 3 | Modify — secure MCP execution |
| `app/tools/schemas.py` | 3 | Create — ToolDescriptor model |
| `app/services/mcp/oauth/client.py` | 4 | Create — token exchange |
| `app/services/mcp/oauth/state.py` | 4 | Create — state validation |
| `app/services/mcp/oauth/pkce.py` | 4 | Create — PKCE |
| `components/settings/mcp-settings.tsx` | 1 | Modify — add auth-type-specific forms |
| `components/settings/mcp-server-form.tsx` | 1 | Create — add/edit server dialog |
| `components/settings/auth-type-selector.tsx` | 1 | Create |
| `components/settings/credential-fields.tsx` | 1 | Create — discriminated union form |
| `components/settings/custom-headers-editor.tsx` | 1 | Create |
| `components/settings/oauth-connect-button.tsx` | 4 | Create |
| `lib/api/mcp.ts` | 1+2+4 | Modify — add test, discover, OAuth APIs |
| `components/chat/add-mcp-dialog.tsx` | 1 | Modify — add auth step |
