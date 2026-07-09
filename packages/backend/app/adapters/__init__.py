"""Provider adapters — concrete implementations of the kernel `AgentProvider` seam.

Each adapter maps a concrete integration (its SDK, wire types, quirks) INTO the kernel contract.
SDK types and semantics never cross this boundary: outward flows only contract events/operations
(blueprint §1.4, deliverable 1). A new provider = a new adapter here; the kernel is untouched.
"""
