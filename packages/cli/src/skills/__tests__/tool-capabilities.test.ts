/**
 * Tool Capabilities Tests
 */

import { describe, it, expect } from 'vitest';
import {
  TOOL_CAPABILITIES,
  getToolCapability,
  getToolsByCategory,
  findReplacementTool,
  detectRedundantPackage,
  generateToolContextForPlanner
} from '../tool-capabilities.js';

describe('Tool Capabilities Registry', () => {
  it('should have capabilities for all core tools', () => {
    const coreTools = [
      'ask-user-question',
      'read-file',
      'write-file',
      'edit-file',
      'list-dir',
      'get-cwd',
      'path-exists',
      'glob',
      'grep',
      'explore-agent',
      'exec-command',
      'web-fetch',
      'web-search',
      'knowledge-query'
    ];

    for (const tool of coreTools) {
      const capability = getToolCapability(tool);
      expect(capability).toBeDefined();
      expect(capability?.id).toBe(tool);
      expect(capability?.capabilities.length).toBeGreaterThan(0);
    }
  });

  it('should categorize tools correctly', () => {
    const filesystemTools = getToolsByCategory('filesystem');
    expect(filesystemTools.length).toBeGreaterThan(0);
    expect(filesystemTools.some(t => t.id === 'read-file')).toBe(true);

    const searchTools = getToolsByCategory('search');
    expect(searchTools.length).toBeGreaterThan(0);
    expect(searchTools.some(t => t.id === 'glob')).toBe(true);

    const webTools = getToolsByCategory('web');
    expect(webTools.length).toBeGreaterThan(0);
    expect(webTools.some(t => t.id === 'web-fetch')).toBe(true);
  });

  it('should find replacement for external tools', () => {
    // web-fetch should replace puppeteer
    const puppeteerReplacement = findReplacementTool('puppeteer');
    expect(puppeteerReplacement?.id).toBe('web-fetch');

    const playwrightReplacement = findReplacementTool('playwright');
    expect(playwrightReplacement?.id).toBe('web-fetch');

    // glob should replace find
    const findReplacement = findReplacementTool('find');
    expect(findReplacement?.id).toBe('glob');

    // grep should replace ripgrep
    const rgReplacement = findReplacementTool('rg');
    expect(rgReplacement?.id).toBe('grep');
  });

  it('should detect redundant packages', () => {
    const puppeteerCheck = detectRedundantPackage('puppeteer');
    expect(puppeteerCheck?.id).toBe('web-fetch');

    const playwrightCheck = detectRedundantPackage('playwright');
    expect(playwrightCheck?.id).toBe('web-fetch');

    const seleniumCheck = detectRedundantPackage('selenium');
    expect(seleniumCheck?.id).toBe('web-fetch');
  });

  it('should generate planner context', () => {
    const context = generateToolContextForPlanner();

    // Should include tool categories
    expect(context).toContain('Filesystem:');
    expect(context).toContain('Search:');
    expect(context).toContain('Web');
    expect(context).toContain('Execution:');

    // Should mention critical rules
    expect(context).toContain('NEVER suggest installing: puppeteer');
    expect(context).toContain('web-fetch');

    // Should show replacements
    expect(context).toContain('REPLACES:');
  });

  it('should include limitations for web-fetch', () => {
    const webFetch = getToolCapability('web-fetch');
    expect(webFetch?.limitations).toBeDefined();
    expect(webFetch?.limitations.length).toBeGreaterThan(0);
    expect(webFetch?.limitations.some(l => l.includes('JavaScript'))).toBe(true);
  });

  it('should have usage notes for critical tools', () => {
    const webFetch = getToolCapability('web-fetch');
    expect(webFetch?.usageNotes).toBeDefined();
    expect(webFetch?.usageNotes).toContain('NEVER suggest installing puppeteer');

    const editFile = getToolCapability('edit-file');
    expect(editFile?.usageNotes).toBeDefined();
  });
});
