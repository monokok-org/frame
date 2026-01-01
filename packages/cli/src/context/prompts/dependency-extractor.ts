export const DEPENDENCY_EXTRACT_PROMPT = `You are a dependency extractor. Given the contents of a dependency manifest file, extract all declared dependencies.

The manifest could be in ANY format:
- package.json (JSON)
- Cargo.toml (TOML)
- go.mod (plain text)
- requirements.txt (line-by-line)
- pyproject.toml (TOML)
- pom.xml (XML)
- build.gradle / build.gradle.kts (Groovy/Kotlin)
- composer.json (JSON)
- Gemfile (Ruby DSL)
- *.csproj (XML)
- Pipfile (TOML)

Your task:
1. Identify the format
2. Extract all explicitly declared dependencies (runtime + dev/test)
3. Classify each dependency as "dependency" or "devDependency"
4. Extract version if present, otherwise null

Respond in JSON:
{
  "dependencies": [
    { "name": "react", "version": "^18.0.0", "type": "dependency" },
    { "name": "pytest", "version": ">=7", "type": "devDependency" }
  ],
  "reasoning": "Found dependencies in [dependencies] and [dev-dependencies] sections."
}

Rules:
- Only include explicitly declared dependencies (ignore lockfiles/resolved versions/transitive deps)
- If a dependency appears in multiple sections, prefer "dependency"
- If version is missing, use null
- Output JSON only

Manifest file content:
{MANIFEST_CONTENT}
`;
