---
id: uam
name: User Access Management (RBAC)
area: platform
status: beta
version: 2026.4.42
depends: [shared-schema]
terms: []
spec: ../README.md#what-it-does
api: |
  POST /uam/login — identify against the allow-list, issue 7-day token + cookie (any · API key)
  POST /uam/logout — clear the portal session cookie (portal · API key)
  GET /uam/me — current identity with fresh role (any · API key)
  GET /uam/users — allow-list table (portal · Owner/Manager)
  POST /uam/users — add user with role (portal · Owner/Manager)
  PATCH /uam/users/:id — edit user / change role, last-Owner guarded (portal · Owner/Manager)
  DELETE /uam/users/:id — remove user, last-Owner guarded (portal · Owner/Manager)
arch: |
  flowchart LR
    subgraph Clients
      P["Portal login page - email"] --> L
      A["iOS app - email + employee ID"] --> L
    end
    L["POST /uam/login"] --> ST[("uam-users store - manually managed allow-list")]
    L -->|"HMAC token, email only"| TK["sib_user cookie / X-User-Token header"]
    TK --> CU["currentUamUser - role RE-READ per request"]
    CU --> G1["adminKeyAuth: Owner/Manager pass destructive gate by role"]
    CU --> G2["requireRole middleware on route surfaces"]
    subgraph UAM["Portal Admin - UAM table"]
      T["add / edit / remove users - canManageRole rules"]
    end
    T --> ST
    SSO["Future SSO: OIDC + HYPR replaces token issuing only"] -.-> CU
---
Role-based access ahead of corporate SSO: a manually managed allow-list
(email + employee ID + role) governs who can sign in and what they can do.
Four roles — Owner, Manager, Engineer, Technician — with server-enforced
management rules: Managers run the user table but can never touch Owner
records, and the last Owner can be neither demoted nor removed. Tokens carry
only the identity; the role is re-read on every request, so a role change or
removal takes effect immediately. The legacy admin key acts as Owner during
bootstrap and transition. When SSO (OIDC + HYPR) arrives, only token issuing
changes — every role rule survives.
