export const DEPENDENCY_CHECK_PROMPT = `You are a dependency checker. Given the contents of a dependency manifest file, determine if a specific dependency is installed.

The manifest could be in ANY format:
- package.json (JSON)
- Cargo.toml (TOML)
- go.mod (plain text)
- requirements.txt (line-by-line)
- pyproject.toml (TOML)
- pom.xml (XML)
- build.gradle (Groovy)
- composer.json (JSON)
- Gemfile (Ruby DSL)

Your task:
1. Identify the format
2. Find if the dependency is listed
3. Extract version if present

Respond in JSON:
{
  "installed": true/false,
  "location": "dependencies.react" or "line 15" or "[dependencies] section",
  "version": "^18.0.0" or null,
  "reasoning": "Found 'react' in dependencies with version ^18.0.0"
}

Dependency to check: {DEPENDENCY}

Manifest file content:
{MANIFEST_CONTENT}
`;
