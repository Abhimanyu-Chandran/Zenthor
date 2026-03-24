const requiredForBuild = [
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
];

const missing = requiredForBuild.filter((name) => !process.env[name]);

if (missing.length > 0) {
  const message = [
    "Build blocked: missing required environment variables.",
    "",
    ...missing.map((name) => `- ${name}`),
    "",
    "Set these in:",
    "- Local: .env.local",
    "- Vercel: Project Settings -> Environment Variables",
  ].join("\n");

  console.error(message);
  process.exit(1);
}

console.log("Environment validation passed.");
