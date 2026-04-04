/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseTool, ToolResult } from './tools.js';
import { Type } from '@google/genai';
import { SchemaValidator } from '../utils/schemaValidator.js';
import { getErrorMessage } from '../utils/errors.js';
import { fetchWithTimeout } from '../utils/fetch.js';
import { Config } from '../config/config.js';

/**
 * Parameters for the WebSearchTool.
 */
export interface WebSearchToolParams {
  /**
   * The search query.
   */
  query: string;
}

/**
 * A single search result from DuckDuckGo.
 */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Extends ToolResult to include sources for web search.
 */
export interface WebSearchToolResult extends ToolResult {
  sources?: SearchResult[];
}

/**
 * DuckDuckGo HTML search URL endpoint.
 */
const DDG_HTML_SEARCH_URL = 'https://html.duckduckgo.com/html/';

/**
 * Timeout for fetching search results in milliseconds.
 */
const SEARCH_FETCH_TIMEOUT_MS = 10000;

/**
 * Maximum number of search results to return.
 */
const MAX_RESULTS = 10;

/**
 * A tool to perform web searches using DuckDuckGo.
 */
export class WebSearchTool extends BaseTool<WebSearchToolParams, WebSearchToolResult> {
  static readonly Name: string = 'google_web_search';

  constructor(private readonly config?: Config) {
    super(WebSearchTool.Name, 'GoogleSearch', 'Performs a web search using DuckDuckGo and returns the results. This tool is useful for finding information on the internet based on a query.', {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'The search query to find information on the web.',
        },
      },
      required: ['query'],
    });
  }

  /**
   * Validates the parameters for the WebSearchTool.
   * @param params The parameters to validate
   * @returns An error message string if validation fails, null if valid
   */
  validateParams(params: WebSearchToolParams): string | null {
    const errors = SchemaValidator.validate(this.schema.parameters, params);
    if (errors) {
      return errors;
    }

    if (!params.query || params.query.trim() === '') {
      return "The 'query' parameter cannot be empty.";
    }
    return null;
  }

  getDescription(params: WebSearchToolParams): string {
    return `Searching DuckDuckGo for: "${params.query}"`;
  }

  /**
   * Parses DuckDuckGo HTML search results into structured data.
   */
  private parseSearchResults(html: string): SearchResult[] {
    const results: SearchResult[] = [];

    // DuckDuckGo HTML results use result__a class for titles
    // Pattern: <a class="result__a" href="...">Title</a>
    const titleRegex = /<a\s+class="result__a"\s+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;

    let match;
    while ((match = titleRegex.exec(html)) !== null && results.length < MAX_RESULTS) {
      const url = match[1];
      const title = this.cleanText(match[2]);

      if (title && url) {
        results.push({
          title,
          url: this.normalizeUrl(url),
          snippet: '',
        });
      }
    }

    // If no results found with the primary regex, try alternative patterns
    if (results.length === 0) {
      // Alternative pattern for result links
      const altRegex = /<a[^>]*class="result[^"]*"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
      while ((match = altRegex.exec(html)) !== null && results.length < MAX_RESULTS) {
        const url = match[1];
        const title = this.cleanText(match[2]);

        if (title && url) {
          results.push({
            title,
            url: this.normalizeUrl(url),
            snippet: '',
          });
        }
      }
    }

    // Extract snippets from result snippets if available
    if (results.length > 0) {
      const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([^<]*(?:<[^>]*>[^<]*)*)<\/a>/gi;
      const snippets: string[] = [];
      let snippetMatch;
      while ((snippetMatch = snippetRegex.exec(html)) !== null) {
        snippets.push(this.cleanText(snippetMatch[1]));
      }

      // Assign snippets to results
      for (let i = 0; i < results.length && i < snippets.length; i++) {
        results[i].snippet = snippets[i];
      }
    }

    return results;
  }

  /**
   * Normalizes a URL, handling DuckDuckGo's redirect URLs.
   */
  private normalizeUrl(url: string): string {
    // DuckDuckGo sometimes uses redirect URLs, extract the actual URL if needed
    if (url.includes('uddg=')) {
      try {
        const urlObj = new URL(url);
        const redirectedUrl = urlObj.searchParams.get('uddg');
        if (redirectedUrl) {
          return redirectedUrl;
        }
      } catch {
        // Ignore parsing errors, return original
      }
    }
    return url;
  }

  /**
   * Cleans HTML text content.
   */
  private cleanText(text: string): string {
    return text
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  async execute(params: WebSearchToolParams, signal: AbortSignal): Promise<WebSearchToolResult> {
    const validationError = this.validateToolParams(params);
    if (validationError) {
      return {
        llmContent: `Error: Invalid parameters provided. Reason: ${validationError}`,
        returnDisplay: validationError,
      };
    }

    try {
      // Use GET request with query parameter for DuckDuckGo HTML
      const searchUrl = `${DDG_HTML_SEARCH_URL}?q=${encodeURIComponent(params.query)}`;

      const response = await fetchWithTimeout(searchUrl, SEARCH_FETCH_TIMEOUT_MS);

      if (!response.ok) {
        throw new Error(`DuckDuckGo returned status ${response.status}`);
      }

      const html = await response.text();

      // Debug: log raw HTML for troubleshooting
      if (this.config?.getDebugMode()) {
        console.log('[WebSearch] Raw HTML response:', html.substring(0, 2000));
      }

      const results = this.parseSearchResults(html);

      if (results.length === 0) {
        return {
          llmContent: `No search results found for query: "${params.query}"`,
          returnDisplay: 'No results found.',
        };
      }

      // Format results for display
      const formattedResults = results
        .map(
          (r, i) =>
            `${i + 1}. **${r.title}**\n   URL: ${r.url}\n   ${r.snippet ? r.snippet.substring(0, 200) : ''}`,
        )
        .join('\n\n');

      const sourcesList = results
        .map((r, i) => `[${i + 1}] ${r.title} (${r.url})`)
        .join('\n');

      const fullResponse = `Web search results for "${params.query}":\n\n${formattedResults}\n\nSources:\n${sourcesList}`;

      return {
        llmContent: fullResponse,
        returnDisplay: `Found ${results.length} result(s) for "${params.query}"`,
        sources: results,
      };
    } catch (error: unknown) {
      const errorMessage = `Error during web search for query "${params.query}": ${getErrorMessage(error)}`;
      console.error(errorMessage, error);
      return {
        llmContent: `Error: ${errorMessage}`,
        returnDisplay: 'Error performing web search.',
      };
    }
  }
}
