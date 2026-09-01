# Tenant manifests

This directory holds non-secret desired-state examples and, later, reviewed tenant declarations. Generated `tenant.env`, homes, state, and secrets belong under `/srv/neural-labs/tenants`, never in Git.

Port assignments must be unique. Use a developer identifier that does not expose unnecessary personal information. A future reconciler may consume these manifests; the current provisioning script takes explicit command-line arguments instead.
