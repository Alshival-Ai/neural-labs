# Connection-authenticated graph replication

The optional managed adapter may replicate the shared task graph as a service, independent of member browser sessions. User-bound project API keys retain their existing authorization.

The bridge signs its operation domain, exact payload and timestamp. It checks the configured workspace and instance and asks the portal to authorize the supplied generation on every operation. The integrating service owns live entitlement, protected-residency and pause decisions. No user-supplied origin is followed with credentials.

Only the bridge constructs the graph service actor. Its stored user is disabled, has no login identity and is never granted a session. Verified subject bindings provision actual graph members without email-based linking. Assigned members must remain authorized on each write. Snapshots identify system-authored records explicitly so an unattributed note does not become an invented human author.

PostgreSQL mutation transactions remain the revision, idempotency, visibility and dependency validation boundary. Source edit clocks survive replication; native writes replace them using the database clock. Historical records with no reliable source timestamp use the epoch for statuses and existing persisted times for other records. The portal handles concurrent-edit policy and retains comparison history before overwrites.

Invalid signatures, generation changes, revoked connections and unavailable authorization fail closed. Unmapped historical authors need an administrator binding; they never acquire membership from graph content. Standalone installations expose no bridge and retain their independent graph.
