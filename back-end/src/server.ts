import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";
import nodemailer from "nodemailer";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// ============================================
// DATA STRUCTURES
// ============================================

interface User {
  id: string;
  email: string;
  username: string;
  createdAt: Date;
}

interface VerificationCode {
  email: string;
  code: string;
  username: string;
  expiresAt: Date;
}

interface Session {
  userId: string;
  expiresAt: Date;
}

// In-memory storage (replace with database in production)
const users = new Map<string, User>();
const verificationCodes = new Map<string, VerificationCode>();
const sessions = new Map<string, Session>();

// ============================================
// EMAIL SERVICE
// ============================================

// Configure email transporter
// For development, use Ethereal (fake SMTP)
// For production, use Gmail, SendGrid, etc.
let transporter: nodemailer.Transporter;

async function createEmailTransporter() {
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    // Production: Use Gmail
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });
    console.log("📧 Using Gmail for emails");
  } else {
    // Development: Use Ethereal (fake SMTP for testing)
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
    console.log("📧 Using Ethereal (test email) - check logs for preview URLs");
  }
}

createEmailTransporter();

async function sendVerificationEmail(
  email: string,
  code: string,
  username: string,
) {
  const info = await transporter.sendMail({
    from: process.env.GMAIL_USER || '"Your App" <noreply@yourapp.com>',
    to: email,
    subject: "Your Verification Code",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Welcome, ${username}! 👋</h2>
        <p>Your verification code is:</p>
        <div style="background: #f5f5f5; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 8px; border-radius: 8px; margin: 20px 0;">
          ${code}
        </div>
        <p style="color: #666;">This code will expire in 10 minutes.</p>
        <p style="color: #666; font-size: 12px;">If you didn't request this code, you can safely ignore this email.</p>
      </div>
    `,
  });

  // Log preview URL for Ethereal (development)
  if (!process.env.GMAIL_USER) {
    console.log("📧 Preview email: " + nodemailer.getTestMessageUrl(info));
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateId(): string {
  return crypto.randomBytes(16).toString("hex");
}

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

// ============================================
// AUTH MIDDLEWARE
// ============================================

interface AuthRequest extends Request {
  userId: string;
}

async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");

    if (!token) {
      res.status(401).json({ error: "No token provided" });
      return;
    }

    const session = sessions.get(token);

    if (!session || session.expiresAt < new Date()) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }

    (req as AuthRequest).userId = session.userId;
    next();
  } catch (error) {
    console.error("Auth error:", error);
    res.status(401).json({ error: "Authentication failed" });
  }
}

// ============================================
// AUTHENTICATION ENDPOINTS
// ============================================

// Send verification code
app.post("/api/auth/send-code", async (req, res) => {
  try {
    const { email, username } = req.body;

    if (!email || !username) {
      res.status(400).json({ error: "Email and username are required" });
      return;
    }

    // Validate email format
    if (!email.includes("@")) {
      res.status(400).json({ error: "Invalid email format" });
      return;
    }

    // Generate 6-digit code
    const code = generateCode();

    // Store code with 10-minute expiry
    verificationCodes.set(email, {
      email,
      code,
      username,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    });

    // Send email
    await sendVerificationEmail(email, code, username);

    console.log(`📧 Sent code ${code} to ${email} (for testing)`);

    res.json({
      success: true,
      message: "Verification code sent to your email",
    });
  } catch (error) {
    console.error("Send code error:", error);
    res.status(500).json({ error: "Failed to send verification code" });
  }
});

// Verify code and sign in
app.post("/api/auth/verify-code", async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      res.status(400).json({ error: "Email and code are required" });
      return;
    }

    // Check if code exists and is valid
    const storedCode = verificationCodes.get(email);

    if (!storedCode) {
      res
        .status(400)
        .json({ error: "No verification code found for this email" });
      return;
    }

    if (storedCode.expiresAt < new Date()) {
      verificationCodes.delete(email);
      res.status(400).json({ error: "Verification code expired" });
      return;
    }

    if (storedCode.code !== code) {
      res.status(400).json({ error: "Invalid verification code" });
      return;
    }

    // Code is valid! Create or get user
    let user = Array.from(users.values()).find((u) => u.email === email);

    if (!user) {
      // Create new user
      user = {
        id: generateId(),
        email,
        username: storedCode.username,
        createdAt: new Date(),
      };
      users.set(user.id, user);
      console.log(`✅ Created new user: ${user.username} (${user.email})`);
    } else {
      console.log(`✅ User signed in: ${user.username} (${user.email})`);
    }

    // Delete used code
    verificationCodes.delete(email);

    // Create session
    const token = generateToken();
    sessions.set(token, {
      userId: user.id,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
      },
    });
  } catch (error) {
    console.error("Verify code error:", error);
    res.status(500).json({ error: "Verification failed" });
  }
});

// Get current user
app.get("/api/auth/user", requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthRequest).userId;
    const user = users.get(userId);

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({
      id: user.id,
      email: user.email,
      username: user.username,
    });
  } catch (error) {
    console.error("Get user error:", error);
    res.status(500).json({ error: "Failed to get user" });
  }
});

// Sign out
app.post("/api/auth/signout", requireAuth, async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (token) {
      sessions.delete(token);
    }
    res.json({ success: true });
  } catch (error) {
    console.error("Sign out error:", error);
    res.status(500).json({ error: "Sign out failed" });
  }
});

// ============================================
// HEALTH CHECK
// ============================================

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    users: users.size,
    activeSessions: sessions.size,
  });
});

// ============================================
// CLEANUP OLD CODES (run every 5 minutes)
// ============================================

setInterval(
  () => {
    const now = new Date();
    let cleaned = 0;

    for (const [email, data] of verificationCodes.entries()) {
      if (data.expiresAt < now) {
        verificationCodes.delete(email);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`🧹 Cleaned up ${cleaned} expired verification codes`);
    }
  },
  5 * 60 * 1000,
);

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(
    `📧 Email service: ${process.env.GMAIL_USER ? "Gmail" : "Ethereal (test)"}`,
  );
});
