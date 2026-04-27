---
name: create-specification
description: 'Create a new AI-ready solution specification as an entry in Plane.so Pages, the Plane Knowledge Management feature, not as a local /spec file. Use this whenever the user asks to create a spec, specification, technical design, requirements document, architecture spec, process spec, schema spec, or implementation contract that should live in Plane.so Pages.'
---

# Create Specification

Your goal is to create a new specification in **Plane.so Pages** for `${input:SpecPurpose}`.

The specification must define the requirements, constraints, and interfaces for the solution components in a manner that is clear, unambiguous, and structured for effective use by Generative AIs. Follow established documentation standards and ensure the content is machine-readable and self-contained.

## Storage Location

Create the specification as a **Plane.so Pages entry**, which is Plane's Knowledge Management feature for technical documentation, product requirements, meeting notes, and specifications. Do not create or update local files under `/spec`, `spec/`, `docs/spec`, or any other filesystem directory unless the user explicitly asks for a local copy in addition to the Plane Pages entry.

Use the `plane-operations` skill and the available Plane tools to access Plane. Prefer `plane_create_project_page` when the relevant Plane project is known; this creates a Project Page under that project's Pages module. Use `plane_create_workspace_page` only when the spec should live as workspace-wide / Wiki-level documentation.

Before creating a Page:

1. Resolve the target Plane Pages scope from the request or current context:
   - Project Page: a specific Plane project is mentioned or inferable.
   - Workspace/Wiki Page: the spec applies across projects or no single project is clear.
2. Read before write where practical: list/retrieve relevant projects or existing work items/pages when needed to avoid ambiguity or duplicates.
3. Use a concise Plane Pages title following this convention:
   - `[SPEC] [High-level Purpose] - [Work Item ID] [Descriptive Subject]`
   - High-level purpose should be one of: `Schema`, `Tool`, `Data`, `Infrastructure`, `Process`, `Architecture`, or `Design`.
   - Include the Plane work item ID when available. If no work item ID is available, omit that segment and use `[SPEC] [High-level Purpose] - [Descriptive Subject]`.
4. Put the full specification body in the Plane Pages `description_html` field. Use semantic HTML generated from the Markdown structure below (`<h1>`, `<h2>`, `<ul>`, `<table>`, `<pre><code>`, etc.) so the Page renders correctly in Plane.
5. After creation, report the Plane Pages ID/link returned by the tool, the scope used, and any assumptions.

## Best Practices for AI-Ready Specifications

- Use precise, explicit, and unambiguous language.
- Clearly distinguish between requirements, constraints, and recommendations.
- Use structured formatting (headings, lists, tables) for easy parsing.
- Avoid idioms, metaphors, or context-dependent references.
- Define all acronyms and domain-specific terms.
- Include examples and edge cases where applicable.
- Ensure the document is self-contained and does not rely on external context.

The specification content should be drafted in well-formed Markdown first for clarity, then converted to clean HTML for Plane Pages creation.

Specification Pages must follow the template below, ensuring that all sections are filled out appropriately. Include the metadata block at the top of the Page body instead of filesystem front matter:

```md
> **Title:** [Concise Title Describing the Specification's Focus]  
> **Version:** [Optional: e.g., 1.0, Date]  
> **Date Created:** [YYYY-MM-DD]  
> **Last Updated:** [Optional: YYYY-MM-DD]  
> **Owner:** [Optional: Team/Individual responsible for this spec]  
> **Tags:** [Optional: List of relevant tags or categories, e.g., `infrastructure`, `process`, `design`, `app` etc]

# Introduction

[A short concise introduction to the specification and the goal it is intended to achieve.]

## 1. Purpose & Scope

[Provide a clear, concise description of the specification's purpose and the scope of its application. State the intended audience and any assumptions.]

## 2. Definitions

[List and define all acronyms, abbreviations, and domain-specific terms used in this specification.]

## 3. Requirements, Constraints & Guidelines

[Explicitly list all requirements, constraints, rules, and guidelines. Use bullet points or tables for clarity.]

- **REQ-001**: Requirement 1
- **SEC-001**: Security Requirement 1
- **[3 LETTERS]-001**: Other Requirement 1
- **CON-001**: Constraint 1
- **GUD-001**: Guideline 1
- **PAT-001**: Pattern to follow 1

## 4. Interfaces & Data Contracts

[Describe the interfaces, APIs, data contracts, or integration points. Use tables or code blocks for schemas and examples.]

## 5. Acceptance Criteria

[Define clear, testable acceptance criteria for each requirement using Given-When-Then format where appropriate.]

- **AC-001**: Given [context], When [action], Then [expected outcome]
- **AC-002**: The system shall [specific behavior] when [condition]
- **AC-003**: [Additional acceptance criteria as needed]

## 6. Test Automation Strategy

[Define the testing approach, frameworks, and automation requirements.]

- **Test Levels**: Unit, Integration, End-to-End
- **Frameworks**: MSTest, FluentAssertions, Moq (for .NET applications)
- **Test Data Management**: [approach for test data creation and cleanup]
- **CI/CD Integration**: [automated testing in GitHub Actions pipelines]
- **Coverage Requirements**: [minimum code coverage thresholds]
- **Performance Testing**: [approach for load and performance testing]

## 7. Rationale & Context

[Explain the reasoning behind the requirements, constraints, and guidelines. Provide context for design decisions.]

## 8. Dependencies & External Integrations

[Define the external systems, services, and architectural dependencies required for this specification. Focus on **what** is needed rather than **how** it's implemented. Avoid specific package or library versions unless they represent architectural constraints.]

### External Systems
- **EXT-001**: [External system name] - [Purpose and integration type]

### Third-Party Services
- **SVC-001**: [Service name] - [Required capabilities and SLA requirements]

### Infrastructure Dependencies
- **INF-001**: [Infrastructure component] - [Requirements and constraints]

### Data Dependencies
- **DAT-001**: [External data source] - [Format, frequency, and access requirements]

### Technology Platform Dependencies
- **PLT-001**: [Platform/runtime requirement] - [Version constraints and rationale]

### Compliance Dependencies
- **COM-001**: [Regulatory or compliance requirement] - [Impact on implementation]

**Note**: This section should focus on architectural and business dependencies, not specific package implementations. For example, specify "OAuth 2.0 authentication library" rather than "Microsoft.AspNetCore.Authentication.JwtBearer v6.0.1".

## 9. Examples & Edge Cases

    ```code
    // Code snippet or data example demonstrating the correct application of the guidelines, including edge cases
    ```

## 10. Validation Criteria

[List the criteria or tests that must be satisfied for compliance with this specification.]

## 11. Related Specifications / Further Reading

[Link to related spec 1]
[Link to relevant external documentation]

```

## Plane Pages Creation Checklist

- Load and follow `plane-operations` whenever Plane access is required.
- Resolve whether to use a Project Page or Workspace/Wiki Page in Plane.so Pages.
- Create the Plane.so Pages entry with:
  - `name`: `[SPEC] [Purpose] - [Work Item ID] [Subject]`
  - `description_html`: the rendered HTML version of the completed specification
  - `project_id`: only for Project Pages
- Do not write a local `/spec/*.md` file as the primary deliverable.
- Do not confuse Plane.so Pages with filesystem pages, website pages, frontend routes, or generic documents.
- Final response must include the created Plane Pages identifier/link and the scope used.
