# Jammaz System — Documentation Index

This is the single source of truth for the Jammaz ERP system's stabilization and improvement roadmap.

## Documentation Structure

| Section | Document | Description |
|---------|----------|-------------|
| 📋 **Project Overview** | `00-project-overview.md` | High-level project summary, technology stack, architecture |
| 📊 **Current State** | `01-current-state.md` | What works, what's broken, production readiness status |
| 🏗️ **Architecture Audit** | `02-architecture-audit.md` | Architectural analysis, patterns, coupling, cohesion |
| 🔒 **Security Audit** | `03-security-audit.md` | Security vulnerabilities, authentication, authorization |
| 🧩 **Backend Audit** | `04-backend-audit.md` | API, routes, services, controllers, database |
| 📝 **Business Logic Audit** | `05-business-logic-audit.md` | Calculations, validations, state transitions, edge cases |
| 🎨 **UX/UI Audit** | `06-ux-ui-audit.md` | UI/UX review (frontend not in this repo) |
| ⚡ **Performance Audit** | `08-performance-audit.md` | Bottlenecks, query optimization, bundle analysis |
| 🧹 **Code Quality Audit** | `09-code-quality-audit.md` | Dead code, duplications, typing, naming |
| 🗃️ **Database Audit** | `10-database-audit.md` | Schema, relationships, indexes, queries |
| ✅ **Testing Audit** | `11-testing-audit.md` | Test coverage, quality, CI/CD |
| 📦 **DevOps Audit** | `12-devops-audit.md` | Build, deployment, environment, monitoring |
| 🌐 **SEO/Accessibility** | `13-seo-accessibility-audit.md` | (Not applicable for backend-only) |
| 📁 **Findings Registry** | `findings/README.md` | Master registry of all audit findings |
| 📁 **Roadmap** | `roadmap/README.md` | Phased remediation plan with dependencies |
| 📁 **Task Files** | `tasks/` | Individual remediation tasks |
| 🏗️ **Architecture** | `architecture/` | Current vs target architecture documents |

## Quick Links

- [Current State](01-current-state.md)
- [Findings Registry](findings/README.md)
- [Roadmap](roadmap/README.md)
- [Task Files](tasks/)
- [Architecture](architecture/)

## Project Status

<details>
<summary>Click to expand</summary>

The Jammaz System is a Node.js/Express/MongoDB ERP backend application currently needing stabilization. Critical areas include authentication/authorization flows, financial calculation consistency, and data integrity across interconnected services.

</details>

## Severity Summary

| Severity | Count |
|----------|-------|
| Critical | _X_ |
| High | _X_ |
| Medium | _X_ |
| Low | _X_ |
| Info | _X_ |

## Estimated Work

- **Total findings**: _X_
- **Critical remediation tasks**: _X_
- **Estimated phases**: 10
- **Production readiness**: Needs stabilization before deployment