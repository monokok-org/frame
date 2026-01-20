/**
 * Knowledge Tool - Web & Docs Search
 * 
 */

import type { Tool } from './types.js';
import { FramebaseClient } from './knowledge/framebase.js';
import { WebSearchClient } from './knowledge/web-search.js';
import { logger } from '../utils/logger.js';

interface KnowledgeInput {
  query: string;
  type?: 'technical' | 'general' | 'auto';
  filters?: string[];
  freshness?: '1d' | '7d' | '30d';
}

interface Source {
  url: string;
  title: string;
}

interface KnowledgeOutput {
  answer: string;
  sources: Source[];
  cached: boolean;
  error?: string;
}

// Freshness to milliseconds
const FRESHNESS_MS: Record<string, number> = {
  '1d': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

// In-memory cache
const cache = new Map<string, { result: KnowledgeOutput; timestamp: number }>();

function getCacheKey(input: KnowledgeInput): string {
  return JSON.stringify({
    q: input.query.toLowerCase().trim(),
    t: input.type,
    f: input.filters?.sort()
  });
}

// Initialize clients
const framebase = new FramebaseClient();
const webSearch = new WebSearchClient();
const year = new Date().getFullYear()
export const knowledgeTool: Tool<KnowledgeInput, KnowledgeOutput> = {
  name: 'search',
  description: `Search for up-to-date documentation, specific library versions, and solutions.
Use 'technical' type with filters for package-specific queries.
Use 'general' type for broad web searches.

IMPORTANT 
  - ALWAYS use this tool for APIs/libraries/packages before installations to get recipe and correct versions. 
  - Use the correct year in search queries:
  - The year is ${year}. You MUST use this year when searching for recent information, documentation, or current events.
  - Example: Instead "latest React docs", search for "React documentation 2026".

Examples:
- search({ query: "write a vite plugin", type: "technical", filters: ["version=\\"v5\\""] })
- search({ query: "latest next.js features 2026", type: "general" })
- search({ query: "react 19 install", type: "technical", filters: ["source\\="react"\\","version=\\"19\\""] })`,

  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query for documentation or solutions'
      },
      type: {
        type: 'string',
        enum: ['technical', 'general'],
        description: 'Search type: technical, general'
      },
      filters: {
        type: 'array',
        items: { type: 'string' },
        description: 'Filters for technical search, e.g. ["source=\\"tokio\\"","version=\\"v2\\""]'
      },
      freshness: {
        type: 'string',
        enum: ['1d', '7d', '30d'],
        description: 'How fresh the results should be (default: 7d)'
      }
    },
    required: ['query']
  },

  async execute(input: KnowledgeInput): Promise<KnowledgeOutput> {
    const freshness = input.freshness ?? '7d';
    const searchType = input.type ?? 'auto';
    const filters = input.filters ?? [];
    const maxAge = FRESHNESS_MS[freshness];
    const cacheKey = getCacheKey(input);

    // Check cache
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < maxAge) {
      return { ...cached.result, cached: true };
    }

    try {
      let answer = '';
      const sources: Source[] = [];

      // Decision Logic
      const shouldQueryFramebase =
        searchType === 'technical' ||
        (searchType === 'auto' && (filters.length > 0 || isTechnicalQuery(input.query)));

      const shouldQueryWeb =
        searchType === 'general' ||
        (searchType === 'auto' && !shouldQueryFramebase);

      // 1. Query Framebase
      if (shouldQueryFramebase) {
        try {
          logger.info(`[Knowledge] Querying Framebase: "${input.query}" filters=${JSON.stringify(filters)}`);
          const fbResponse = await framebase.query({
            q: input.query,
            filters: filters
          });

          if (fbResponse.frames.length > 0) {
            answer += `### Framebase Results\n\n`;
            for (const frame of fbResponse.frames) {
              const content = frame.content || frame.context || '';
              const meta = frame.metadata || {};
              answer += `#### ${meta.source || 'Frame'} (${meta.version || 'unknown'})\n${content}\n\n`;
              if (meta.source) {
                sources.push({ title: `${meta.source} ${meta.version || ''}`, url: 'framebase://' + meta.source });
              }
            }
          } else if (!shouldQueryWeb) {
            answer = `No Framebase results found for "${input.query}". Try adding 'type: "general"' for broader web search.`;
          }
        } catch (err) {
          logger.error('[Knowledge] Framebase error:', err);
          if (!shouldQueryWeb) throw err;
        }
      }

      // 2. Query Web Search (Fallback or Primary)
      if (shouldQueryWeb || (shouldQueryFramebase && answer.length < 100)) {
        try {
          logger.info(`[Knowledge] Querying Web Search: "${input.query}"`);
          const webResults = await webSearch.search(input.query);

          if (webResults.length > 0) {
            answer += `\n### Web Search Results\n\n`;
            for (const result of webResults) {
              answer += `#### [${result.title}](${result.url})\n${result.snippet}\n\n`;
              sources.push({ title: result.title, url: result.url });
            }
          } else {
            if (!answer) answer = `No results found for "${input.query}"`;
          }
        } catch (err) {
          logger.error('[Knowledge] Web search error:', err);
          if (!answer) throw err;
        }
      }

      const result: KnowledgeOutput = {
        answer: "Build a React app from Scratch If your app has constraints not well-served by existing frameworks, you prefer to build your own framework, or you just want to learn the basics of a React app, you can build a React app from scratch.  DEEP DIVE  Consider using a framework    Show Details Step 1: Install a build tool   The first step is to install a build tool like vite, parcel, or rsbuild. These build tools provide features to package and run source code, provide a development server for local development and a build command to deploy your app to a production server.  Vite   Vite is a build tool that aims to provide a faster and leaner development experience for modern web projects.   Terminal  Copy npm create vite@latest my-app -- --template react-ts Vite is opinionated and comes with sensible defaults out of the box. Vite has a rich ecosystem of plugins to support fast refresh, JSX,  Babel/SWC, and other common features. See Vite’s React plugin or React SWC plugin and React SSR example project to get started.  Vite is already being used as a build tool in one of our recommended frameworks: React Router.  Parcel   Parcel combines a great out-of-the-box development experience with a scalable architecture that can take your project from just getting started to massive production applications.   Terminal  Copy npm install --save-dev parcel Parcel supports fast refresh, JSX, TypeScript, Flow, and styling out of the box. See Parcel’s React recipe to get started.  Rsbuild   Rsbuild is an Rspack-powered build tool that provides a seamless development experience for React applications. It comes with carefully tuned defaults and performance optimizations ready to use.   Terminal  Copy npx create-rsbuild --template react Rsbuild includes built-in support for React features like fast refresh, JSX, TypeScript, and styling. See Rsbuild’s React guide to get started.  Note Metro for React Native   If you’re starting from scratch with React Native you’ll need to use Metro, the JavaScript bundler for React Native. Metro supports bundling for platforms like iOS and Android, but lacks many features when compared to the tools here. We recommend starting with Vite, Parcel, or Rsbuild unless your project requires React Native support.  Step 2: Build Common Application Patterns   The build tools listed above start off with a client-only, single-page app (SPA), but don’t include any further solutions for common functionality like routing, data fetching, or styling.  The React ecosystem includes many tools for these problems. We’ve listed a few that are widely used as a starting point, but feel free to choose other tools if those work better for you.  Routing   Routing determines what content or pages to display when a user visits a particular URL. You need to set up a router to map URLs to different parts of your app. You’ll also need to handle nested routes, route parameters, and query parameters.  Routers can be configured within your code, or defined based on your component folder and file structures.  Routers are a core part of modern applications, and are usually integrated with data fetching (including prefetching data for a whole page for faster loading), code splitting (to minimize client bundle sizes), and page rendering approaches (to decide how each page gets generated).  We suggest using:  React Router Tanstack Router Data Fetching   Fetching data from a server or other data source is a key part of most applications. Doing this properly requires handling loading states, error states, and caching the fetched data, which can be complex.  Purpose-built data fetching libraries do the hard work of fetching and caching the data for you, letting you focus on what data your app needs and how to display it.  These libraries are typically used directly in your components, but can also be integrated into routing loaders for faster pre-fetching and better performance, and in server rendering as well.  Note that fetching data directly in components can lead to slower loading times due to network request waterfalls, so we recommend prefetching data in router loaders or on the server as much as possible!  This allows a page’s data to be fetched all at once as the page is being displayed.  If you’re fetching data from most backends or REST-style APIs, we suggest using:  TanStack Query SWR RTK Query If you’re fetching data from a GraphQL API, we suggest using:  Apollo Relay Code-splitting   Code-splitting is the process of breaking your app into smaller bundles that can be loaded on demand. An app’s code size increases with every new feature and additional dependency. Apps can become slow to load because all of the code for the entire app needs to be sent before it can be used. Caching, reducing features/dependencies, and moving some code to run on the server can help mitigate slow loading but are incomplete solutions that can sacrifice functionality if overused.  Similarly, if you rely on the apps using your framework to split the code, you might encounter situations where loading becomes slower than if no code splitting were happening at all. For example, lazily loading a chart delays sending the code needed to render the chart, splitting the chart code from the rest of the app. Parcel supports code splitting with React.lazy. However, if the chart loads its data after it has been initially rendered you are now waiting twice. This is a waterfall: rather than fetching the data for the chart and sending the code to render it simultaneously, you must wait for each step to complete one after the other.  Splitting code by route, when integrated with bundling and data fetching, can reduce the initial load time of your app and the time it takes for the largest visible content of the app to render (Largest Contentful Paint).  For code-splitting instructions, see your build tool docs:  Vite build optimizations Parcel code splitting Rsbuild code splitting Improving Application Performance   Since the build tool you select only supports single page apps (SPAs), you’ll need to implement other rendering patterns like server-side rendering (SSR), static site generation (SSG), and/or React Server Components (RSC). Even if you don’t need these features at first, in the future there may be some routes that would benefit SSR, SSG or RSC.  Single-page apps (SPA) load a single HTML page and dynamically updates the page as the user interacts with the app. SPAs are easier to get started with, but they can have slower initial load times. SPAs are the default architecture for most build tools.  Streaming Server-side rendering (SSR) renders a page on the server and sends the fully rendered page to the client. SSR can improve performance, but it can be more complex to set up and maintain than a single-page app. With the addition of streaming, SSR can be very complex to set up and maintain. See Vite’s SSR guide.  Static site generation (SSG) generates static HTML files for your app at build time. SSG can improve performance, but it can be more complex to set up and maintain than server-side rendering. See Vite’s SSG guide.  React Server Components (RSC) lets you mix build-time, server-only, and interactive components in a single React tree. RSC can improve performance, but it currently requires deep expertise to set up and maintain. See Parcel’s RSC examples.  Your rendering strategies need to integrate with your router so apps built with your framework can choose the rendering strategy on a per-route level. This will enable different rendering strategies without having to rewrite your whole app. For example, the landing page for your app might benefit from being statically generated (SSG), while a page with a content feed might perform best with server-side rendering.  Using the right rendering strategy for the right routes can decrease the time it takes for the first byte of content to be loaded (Time to First Byte), the first piece of content to render (First Contentful Paint), and the largest visible content of the app to render (Largest Contentful Paint).  And more…   These are just a few examples of the features a new app will need to consider when building from scratch. Many limitations you’ll hit can be difficult to solve as each problem is interconnected with the others and can require deep expertise in problem areas you may not be familiar with.  If you don’t want to solve these problems on your own, you can get started with a framework that provides these features out of the box.",
        sources,
        cached: false
      };

      // Cache result
      //cache.set(cacheKey, { result, timestamp: Date.now() });

      return result;

    } catch (error) {
      return {
        answer: '',
        sources: [],
        cached: false,
        error: `Knowledge search failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
};

// Export cache utilities for persistence
export function clearKnowledgeCache(): void {
  cache.clear();
}

export function getKnowledgeCacheSize(): number {
  return cache.size;
}

// Simple heuristic for auto-detection
function isTechnicalQuery(query: string): boolean {
  const techKeywords = ['version', 'config', 'api', 'error', 'exception', 'plugin', 'middleware', 'sdk', 'library', 'framework'];
  return techKeywords.some(k => query.toLowerCase().includes(k));
}
