# Glossary

| Term | Meaning |
|---|---|
| Workspace | A Winix project containing TypeScript specs and generated metadata. |
| Host | A concrete machine target, such as `wsl`, `wsl-work`, `macbook-pro`, or a Windows PC. |
| User | A person or OS account receiving user-scoped configuration. |
| Feature | A reusable configuration branch, usually representing one concern such as Git, shells, editors, JavaScript, WSL, or Syncthing. |
| Role | A reusable bundle of features, such as `developer`, `server`, or `gaming`. |
| Profile | A platform or environment baseline, such as Linux, macOS, WSL, or LXC. |
| Branch | A composable configuration unit in the dendritic graph. |
| Leaf | A concrete resource or final override. |
| Resource | A desired-state item, such as package, service, file, registry key, activation task, or module import. |
| IR | Backend-neutral intermediate representation produced by TypeScript and consumed by Rust. |
| Backend | Adapter that lowers IR to platform tools. |
| Capability | A backend-supported resource kind or behavior. |
| Provenance | Metadata explaining where a resource came from and how it was merged. |
| Activation | Ordered post-generation or post-install operations run by backends. |
| Escape hatch | Explicit raw backend-specific configuration for scenarios not modeled by Winix. |

