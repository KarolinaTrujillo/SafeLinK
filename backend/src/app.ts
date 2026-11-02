import cors from "cors";
import express from "express";
import helmet from "helmet";
import { supabaseAdmin } from "./config/supabase.js";
import { requireAuth } from "./middleware/auth.js";

export const app = express();

const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";

app.use(helmet());
app.use(cors({ origin: frontendUrl }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", async (_request, response) => {
  const { error } = await supabaseAdmin
    .from("perfiles")
    .select("id")
    .limit(1);

  if (error) {
    return response.status(503).json({ status: "error" });
  }

  return response.json({ status: "ok" });
});

app.get("/api/auth/me", requireAuth, (_request, response) => {
  return response.json({ userId: response.locals.userId });
});
