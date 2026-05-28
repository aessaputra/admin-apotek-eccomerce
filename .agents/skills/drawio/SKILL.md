---
name: drawio
description: Always use when user asks to create, generate, draw, or design a diagram, flowchart, architecture diagram, ER diagram, sequence diagram, class diagram, network diagram, mockup, wireframe, UI sketch, mentions draw.io, drawio, drawoi, .drawio files, or diagram export to PNG/SVG/PDF.
allowed-tools: Read, Write, Edit, Bash
---

# Draw.io Diagram Skill

Generate draw.io diagrams as native `.drawio` files. Optionally export to PNG, SVG, or PDF with the diagram XML embedded so the exported file remains editable in draw.io.

This project skill is adapted from the official `jgraph/drawio-mcp` skill-cli skill for OpenCode's `.agents/skills` layout.

## How to create a diagram

1. Generate draw.io XML in `mxGraphModel` format for the requested diagram.
2. Write the XML to a `.drawio` file in the current working directory using the available file-editing tool.
3. If the user requested an export format (`png`, `svg`, or `pdf`), locate the draw.io Desktop CLI, export with embedded XML, then delete the source `.drawio` file only after successful export.
4. If the CLI is not found, keep the `.drawio` file and tell the user they can install draw.io Desktop to enable export, or open the `.drawio` file directly.
5. Open or display the result when possible. In OpenCode, prefer the available draw.io MCP tools for previewing Mermaid/XML diagrams, and print the file path if the local open command is unavailable.

## Choosing the output format

Check the user's request for a format preference.

| Request pattern | Output |
| --- | --- |
| `create a flowchart` | `flowchart.drawio` |
| `png flowchart for login` | `login-flow.drawio.png` |
| `svg: ER diagram` | `er-diagram.drawio.svg` |
| `pdf architecture overview` | `architecture-overview.drawio.pdf` |

If no format is mentioned, write the `.drawio` file. The user can always ask to export later.

## Supported export formats

| Format | Embed XML | Notes |
| --- | --- | --- |
| `png` | Yes (`-e`) | Viewable everywhere, editable in draw.io |
| `svg` | Yes (`-e`) | Scalable, editable in draw.io |
| `pdf` | Yes (`-e`) | Printable, editable in draw.io |
| `jpg` | No | Lossy, no embedded XML support |

PNG, SVG, and PDF all support `--embed-diagram`; the exported file contains the full diagram XML, so opening it in draw.io recovers the editable diagram.

## draw.io CLI

The draw.io desktop app includes a command-line interface for exporting.

### Locating the CLI

First detect the environment, then locate the CLI accordingly.

#### WSL2

WSL2 is detected when `/proc/version` contains `microsoft` or `WSL`:

```bash
grep -qi microsoft /proc/version 2>/dev/null && echo "WSL2"
```

On WSL2, use the Windows draw.io Desktop executable via `/mnt/c/...`:

```bash
'/mnt/c/Program Files/draw.io/draw.io.exe'
```

If draw.io is installed in a non-default location, check common alternatives:

```bash
'/mnt/c/Program Files/draw.io/draw.io.exe'
'/mnt/c/Users/$WIN_USER/AppData/Local/Programs/draw.io/draw.io.exe'
```

#### macOS

```bash
/Applications/draw.io.app/Contents/MacOS/draw.io
```

#### Linux native

```bash
drawio
```

#### Windows native

```text
C:\Program Files\draw.io\draw.io.exe
```

Use `which drawio` on Unix-like systems or `where draw.io` on Windows before falling back to platform-specific paths.

### Export command

```bash
drawio -x -f <format> -e -b 10 -o <output> <input.drawio>
```

WSL2 example:

```bash
'/mnt/c/Program Files/draw.io/draw.io.exe' -x -f png -e -b 10 -o diagram.drawio.png diagram.drawio
```

Key flags:

| Flag | Meaning |
| --- | --- |
| `-x`, `--export` | Export mode |
| `-f`, `--format` | Output format: `png`, `svg`, `pdf`, `jpg` |
| `-e`, `--embed-diagram` | Embed diagram XML in PNG, SVG, or PDF |
| `-o`, `--output` | Output file path |
| `-b`, `--border` | Border width around diagram |
| `-t`, `--transparent` | Transparent background for PNG |
| `-s`, `--scale` | Scale diagram size |
| `--width`, `--height` | Fit into specified dimensions while preserving aspect ratio |
| `-a`, `--all-pages` | Export all pages for PDF |
| `-p`, `--page-index` | Select a specific page, 1-based |

## Opening the result

| Environment | Command |
| --- | --- |
| macOS | `open <file>` |
| Linux native | `xdg-open <file>` |
| WSL2 | `cmd.exe /c start "" "$(wslpath -w <file>)"` |
| Windows | `start <file>` |

If opening is unavailable in a headless environment, report the absolute file path.

## File naming

- Use a descriptive filename based on the diagram content, such as `login-flow` or `database-schema`.
- Use lowercase with hyphens for multi-word names.
- For export, use double extensions: `name.drawio.png`, `name.drawio.svg`, `name.drawio.pdf`.
- After a successful export, delete the intermediate `.drawio` file because the exported file contains the full diagram.

## XML format

A `.drawio` file is native `mxGraphModel` XML. Always generate XML directly for saved `.drawio` files. Mermaid and CSV formats require draw.io conversion and cannot be saved as native `.drawio` files without conversion.

Every diagram must have this structure:

```xml
<mxGraphModel adaptiveColors="auto">
  <root>
    <mxCell id="0"/>
    <mxCell id="1" parent="0"/>
  </root>
</mxGraphModel>
```

- Cell `id="0"` is the root layer.
- Cell `id="1"` is the default parent layer.
- Diagram elements use `parent="1"` unless using containers or multiple layers.

## XML reference

For the complete draw.io XML reference including common styles, edge routing, containers, layers, tags, metadata, dark mode colors, and XML well-formedness rules, fetch and follow:

https://raw.githubusercontent.com/jgraph/drawio-mcp/main/shared/xml-reference.md

## OpenCode MCP usage

If draw.io MCP tools are available in the session, use them for interactive preview:

- Use `drawio_open_drawio_xml` for native draw.io XML previews.
- Use `drawio_open_drawio_mermaid` when the user specifically asks for Mermaid or the diagram is faster to express in Mermaid.
- Use `drawio_open_drawio_csv` for table-driven org charts or simple tabular diagrams.

The MCP preview does not itself create a project `.drawio` file. If the user asks for a file artifact, write the `.drawio` XML to disk as well.

## Troubleshooting

| Problem | Cause | Solution |
| --- | --- | --- |
| draw.io CLI not found | Desktop app not installed or not on PATH | Keep the `.drawio` file and tell the user to install draw.io Desktop or open the `.drawio` file manually |
| Export produces empty/corrupt file | Invalid XML or unescaped special characters | Validate XML well-formedness before writing |
| Diagram opens but looks blank | Missing root cells `id="0"` and `id="1"` | Ensure the basic `mxGraphModel` structure is complete |
| Edges do not render | Edge `mxCell` is self-closing | Every edge must include `<mxGeometry relative="1" as="geometry" />` as a child element |
| File will not open after export | Incorrect path or missing file association | Print the absolute file path so the user can open it manually |

## XML well-formedness

- Never include XML comments (`<!-- -->`) in generated diagram XML.
- Escape special characters in attribute values: `&amp;`, `&lt;`, `&gt;`, `&quot;`.
- Always use unique `id` values for each `mxCell`.
- Every edge `mxCell` must contain a child `<mxGeometry relative="1" as="geometry" />` element.
