export interface McpToolDef {
  name:        string;
  description: string;
  inputSchema: Record<string, unknown>;
  proxyTo:     {
    method:  "GET" | "POST";
    path:    string;
    query?:  string[];
  };
}
