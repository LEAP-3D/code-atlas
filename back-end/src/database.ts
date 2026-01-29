// Simple in-memory database for now (replace with real DB later)
// For production, use PostgreSQL, MongoDB, or SQLite

export interface User {
  id: string;
  email: string;
  password: string; // hashed
  name: string;
  createdAt: Date;
}

export interface Project {
  id: string;
  userId: string;
  name: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Roadmap {
  id: string;
  projectId: string;
  data: RoadmapData;
  createdAt: Date;
}

export interface RoadmapData {
  files: RoadmapFile[];
  totalFiles: number;
  totalFunctions: number;
  totalConnections: number;
}

export interface RoadmapFile {
  path: string;
  name: string;
  functions: RoadmapFunction[];
}

export interface RoadmapFunction {
  name: string;
  filePath: string;
  calls: string[];
  emoji?: string;
  startLine?: number;
  endLine?: number;
}

// In-memory storage (replace with real database)
class Database {
  private users: Map<string, User> = new Map();
  private projects: Map<string, Project> = new Map();
  private roadmaps: Map<string, Roadmap> = new Map();

  // User operations
  createUser(user: User): void {
    this.users.set(user.id, user);
  }

  getUserByEmail(email: string): User | undefined {
    return Array.from(this.users.values()).find((u) => u.email === email);
  }

  getUserById(id: string): User | undefined {
    return this.users.get(id);
  }

  // Project operations
  createProject(project: Project): void {
    this.projects.set(project.id, project);
  }

  getProjectsByUserId(userId: string): Project[] {
    return Array.from(this.projects.values()).filter(
      (p) => p.userId === userId,
    );
  }

  getProjectById(id: string): Project | undefined {
    return this.projects.get(id);
  }

  updateProject(id: string, updates: Partial<Project>): void {
    const project = this.projects.get(id);
    if (project) {
      this.projects.set(id, { ...project, ...updates, updatedAt: new Date() });
    }
  }

  deleteProject(id: string): void {
    this.projects.delete(id);
    // Also delete associated roadmaps
    Array.from(this.roadmaps.entries())
      .filter(([, r]) => r.projectId === id)
      .forEach(([roadmapId]) => this.roadmaps.delete(roadmapId));
  }

  // Roadmap operations
  createRoadmap(roadmap: Roadmap): void {
    this.roadmaps.set(roadmap.id, roadmap);
  }

  getRoadmapsByProjectId(projectId: string): Roadmap[] {
    return Array.from(this.roadmaps.values()).filter(
      (r) => r.projectId === projectId,
    );
  }

  getRoadmapById(id: string): Roadmap | undefined {
    return this.roadmaps.get(id);
  }

  deleteRoadmap(id: string): void {
    this.roadmaps.delete(id);
  }
}

export const db = new Database();
