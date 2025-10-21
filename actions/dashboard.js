"use server"

import {db} from "@/lib/prisma";
import {auth} from "@clerk/nextjs/server";
import {GoogleGenerativeAI} from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({model: "gemini-1.5-flash"});

function extractJson(text) {
    if (!text) return null;
    // Remove code fences and any leading/trailing junk
    let cleaned = text.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
    // Try to extract the first JSON object if there is extra text
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

export const generateAIInsights = async (industry) => {
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

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = await response.text();
    const parsed = extractJson(text);
    if (!parsed) {
        throw new Error("Failed to parse AI insights JSON");
    }
    return normalizeInsights(parsed);
};

export async function getIndustryInsights() {
    const {userId} = await auth();
    if (!userId) {
        throw new Error("Unauthorized");
    }

    const user = await db.user.findUnique({
        where: {
            clerkUserId: userId,
        }, include: {
            industryInsight: true,
        },
    });

    // // Import checkUser function
    // const {checkUser} = await import("@/lib/checkUser");
    // // This will create a user if one doesn't exist
    // const user = await checkUser();

    if (!user) throw new Error("User not found");

    if (!user.industryInsight) {
        const insights = await generateAIInsights(user.industry);
        const normalized = {
            ...insights,
            demandLevel: insights?.demandLevel ? String(insights.demandLevel).toUpperCase() : undefined,
            marketOutlook: insights?.marketOutlook ? String(insights.marketOutlook).toUpperCase() : undefined,
        };

        return await db.industryInsight.create({
            data: {
                industry: user.industry, ...normalized, nextUpdate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            },
        });
    }
    return user.industryInsight;
}