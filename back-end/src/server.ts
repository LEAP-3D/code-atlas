import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { clerkClient } from "@clerk/clerk-sdk-node";
import { Pinecone } from "@pinecone-database/pinecone";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Pinecone
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY!,
});

// Extend Request interface
interface AuthRequest extends Request {
  userId: string;
}

// Auth middleware - verifies Clerk session token
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const sessionToken = req.headers.authorization?.replace("Bearer ", "");

    if (!sessionToken) {
      res.status(401).json({ error: "No session token provided" });
      return;
    }

    // Verify the session with Clerk
    const session = await clerkClient.sessions.verifySession(
      sessionToken,
      sessionToken,
    );

    if (!session) {
      res.status(401).json({ error: "Invalid session" });
      return;
    }

    // Add user info to request
    (req as AuthRequest).userId = session.userId;
    next();
  } catch (error) {
    console.error("Auth error:", error);
    res.status(401).json({ error: "Authentication failed" });
  }
}

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Auth endpoint - get user info
app.get("/api/user", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthRequest).userId;
    const user = await clerkClient.users.getUser(userId);

    res.json({
      id: user.id,
      email: user.emailAddresses[0]?.emailAddress,
      firstName: user.firstName,
      lastName: user.lastName,
    });
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

// Vector interface
interface VectorInput {
  id: string;
  values: number[];
  metadata?: Record<string, unknown>;
}

// Pinecone operations - protected routes
app.post("/api/vectors/upsert", requireAuth, async (req, res) => {
  try {
    const { vectors } = req.body;
    const userId = (req as AuthRequest).userId;

    const index = pinecone.index(process.env.PINECONE_INDEX_NAME!);

    // Add userId to metadata for each vector
    const vectorsWithUser = (vectors as VectorInput[]).map((v) => ({
      ...v,
      metadata: { ...v.metadata, userId },
    }));

    await index.upsert(vectorsWithUser);

    res.json({ success: true, count: vectors.length });
  } catch (error) {
    console.error("Error upserting vectors:", error);
    res.status(500).json({ error: "Failed to upsert vectors" });
  }
});

app.post("/api/vectors/query", requireAuth, async (req, res) => {
  try {
    const { vector, topK = 10 } = req.body;
    const userId = (req as AuthRequest).userId;

    const index = pinecone.index(process.env.PINECONE_INDEX_NAME!);

    const queryResponse = await index.query({
      vector,
      topK,
      filter: { userId }, // Only query user's own vectors
      includeMetadata: true,
    });

    res.json(queryResponse);
  } catch (error) {
    console.error("Error querying vectors:", error);
    res.status(500).json({ error: "Failed to query vectors" });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV}`);
});
