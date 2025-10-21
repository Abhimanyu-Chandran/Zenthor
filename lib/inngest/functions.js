import {inngest} from "./client";
import {db} from "@/lib/prisma";
import {GoogleGenerativeAI} from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({model: "gemini-1.5-flash"});

function extractJson(text) {
    if (!text) return null;
    let cleaned = text.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
        cleaned = cleaned.slice(start, end + 1);
    }
    try {
        return JSON.parse(cleaned);
    } catch (_) {
        return null;
    }
}

function normalizeInsights(insights) {
    if (!insights) return null;
    const normalizeEnum = (v) => (typeof v === "string" ? v.trim().toUpperCase() : undefined);
    const normalizePercent = (v) => {
        if (typeof v === "number") return v;
        if (typeof v === "string") {
            const m = v.match(/-?\d+(?:\.\d+)?/);
            return m ? parseFloat(m[0]) : undefined;
        }
        return undefined;
    };
    return {
        ...insights,
        demandLevel: normalizeEnum(insights.demandLevel),
        marketOutlook: normalizeEnum(insights.marketOutlook),
        growthRate: normalizePercent(insights.growthRate),
    };
}

export const generateIndustryInsights = inngest.createFunction(
    {name: "Generate Industry Insights"},
    {cron: "0 0 * * 0"}, // Run every Sunday at midnight
    async ({step}) => {
        const industries = await step.run("Fetch industries", async () => {
            return await db.industryInsight.findMany({
                select: {industry: true},
            });
        });

        for (const {industry} of industries) {
            const prompt = `
          Analyze the current state of the ${industry} industry and provide insights in ONLY the following JSON format without any additional notes or explanations:
          {
            "salaryRanges": [
              { "role": "string", "min": number, "max": number, "median": number, "location": "string" }
            ],
            "growthRate": number,
            "demandLevel": "High" | "Medium" | "Low",
            "topSkills": ["skill1", "skill2"],
            "marketOutlook": "Positive" | "Neutral" | "Negative",
            "keyTrends": ["trend1", "trend2"],
            "recommendedSkills": ["skill1", "skill2"]
          }
          
          IMPORTANT: Return ONLY the JSON. No additional text, notes, or markdown formatting.
          Include at least 5 common roles for salary ranges.
          Growth rate should be a percentage.
          Include at least 5 skills and trends.
        `;

            const text = await step.ai.wrap(
                "gemini",
                async (p) => {
                    const res = await model.generateContent(p);
                    return await res.response.text();
                },
                prompt
            );

            const parsed = extractJson(text);
            if (!parsed) {
                throw new Error(`Failed to parse AI insights JSON for ${industry}`);
            }
            const insights = normalizeInsights(parsed);

            await step.run(`Upsert ${industry} insights`, async () => {
                await db.industryInsight.upsert({
                    where: {industry},
                    update: {
                        ...insights,
                        lastUpdated: new Date(),
                        nextUpdate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                    },
                    create: {
                        industry,
                        ...insights,
                        lastUpdated: new Date(),
                        nextUpdate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                    },
                });
            });
        }
    }
);