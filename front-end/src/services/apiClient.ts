import { RoadmapData } from "../roadmap/roadmapModel";
import * as https from "https";
import * as http from "http";

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3001";

export interface SaveRoadmapRequest {
  projectName: string;
  roadmapData: RoadmapData;
}

export interface RoadmapSummary {
  id: string;
  projectName: string;
  timestamp: string;
  totalFiles: number;
  totalFunctions: number;
}

export interface RoadmapDetail extends RoadmapSummary {
  roadmapData: RoadmapData;
}

interface SaveRoadmapResponse {
  success: boolean;
  roadmapId: string;
  message: string;
}

interface ListRoadmapsResponse {
  roadmaps: RoadmapSummary[];
}

class ApiClient {
  private async request<T>(
    path: string,
    options: {
      method?: string;
      body?: string;
    } = {},
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const url = new URL(`${API_BASE_URL}${path}`);

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (options.body) {
        headers["Content-Length"] = Buffer.byteLength(options.body).toString();
      }

      const requestOptions = {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        method: options.method || "GET",
        headers,
      };

      const protocol = url.protocol === "https:" ? https : http;

      const req = protocol.request(requestOptions, (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);

            if (
              res.statusCode &&
              res.statusCode >= 200 &&
              res.statusCode < 300
            ) {
              resolve(parsed);
            } else {
              reject(
                new Error(
                  parsed.error ||
                    `Request failed with status ${res.statusCode}`,
                ),
              );
            }
          } catch {
            reject(new Error("Failed to parse response"));
          }
        });
      });

      req.on("error", (error) => {
        reject(error);
      });

      if (options.body) {
        req.write(options.body);
      }

      req.end();
    });
  }

  async saveRoadmap(
    request: SaveRoadmapRequest,
  ): Promise<{ success: boolean; roadmapId: string }> {
    try {
      const data = await this.request<SaveRoadmapResponse>(
        "/api/roadmap/save",
        {
          method: "POST",
          body: JSON.stringify(request),
        },
      );

      return { success: data.success, roadmapId: data.roadmapId };
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error("Failed to save roadmap");
    }
  }

  async listRoadmaps(): Promise<RoadmapSummary[]> {
    try {
      const data =
        await this.request<ListRoadmapsResponse>("/api/roadmap/list");
      return data.roadmaps;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error("Failed to list roadmaps");
    }
  }

  async getRoadmap(roadmapId: string): Promise<RoadmapDetail> {
    try {
      return await this.request<RoadmapDetail>(`/api/roadmap/${roadmapId}`);
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error("Failed to get roadmap");
    }
  }

  async deleteRoadmap(roadmapId: string): Promise<void> {
    try {
      await this.request<{ success: boolean }>(`/api/roadmap/${roadmapId}`, {
        method: "DELETE",
      });
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error("Failed to delete roadmap");
    }
  }
}

export const apiClient = new ApiClient();
