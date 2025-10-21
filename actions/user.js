"use server";

import {auth} from "@clerk/nextjs/server";
import {db} from "@/lib/prisma";
import {generateAIInsights} from "@/actions/dashboard";

export async function updateUser(data) {
    const {userId} = await auth();
    if (!userId) {
        throw new Error("Unauthorized");
    }

    const user = await db.user.findUnique({
        where: {
            clerkUserId: userId,
        },
    });

    // // Import checkUser function
    // const {checkUser} = await import("@/lib/checkUser");
    // // This will create a user if one doesn't exist
    // const user = await checkUser();

    if (!user) throw new Error("Failed to get or create user");

    try {
        // Ensure industry insight exists without using an interactive transaction
        let industryInsight = await db.industryInsight.findUnique({
            where: { industry: data.industry },
        });

        if (!industryInsight) {
            // Try to generate insights, but always fall back to safe defaults
            let insights = null;
            try {
                insights = await generateAIInsights(data.industry);
            } catch (_) {
                // ignore AI errors; we'll use defaults
            }

            const toArray = (v) => Array.isArray(v) ? v : (typeof v === 'string' && v.length ? [v] : []);
            const toJsonArray = (v) => Array.isArray(v) ? v : [];
            const toNumber = (v) => {
                if (typeof v === 'number' && !isNaN(v)) return v;
                const n = parseFloat(v);
                return isNaN(n) ? 0 : n;
            };
            const toDemand = (v) => {
                const s = typeof v === 'string' ? v.toUpperCase() : '';
                return s === 'HIGH' || s === 'LOW' || s === 'MEDIUM' ? s : 'MEDIUM';
            };
            const toOutlook = (v) => {
                const s = typeof v === 'string' ? v.toUpperCase() : '';
                return s === 'POSITIVE' || s === 'NEGATIVE' || s === 'NEUTRAL' ? s : 'NEUTRAL';
            };

            // Build safe defaults and ensure the bar chart has something to render
            let salaryRanges = toJsonArray(insights?.salaryRanges);
            const growthRate = toNumber(insights?.growthRate);
            const demandLevel = toDemand(insights?.demandLevel);
            const topSkills = toArray(insights?.topSkills);
            const marketOutlook = toOutlook(insights?.marketOutlook);
            const keyTrends = toArray(insights?.keyTrends);
            const recommendedSkills = toArray(insights?.recommendedSkills);

            if (!salaryRanges.length) {
                // Deterministic placeholder roles so the chart isn't empty on first load
                const base = [
                    { role: "Junior Developer", min: 45000, median: 60000, max: 80000 },
                    { role: "Mid-level Developer", min: 70000, median: 90000, max: 120000 },
                    { role: "Senior Developer", min: 100000, median: 130000, max: 170000 },
                    { role: "Tech Lead", min: 120000, median: 150000, max: 200000 },
                    { role: "Product Manager", min: 90000, median: 120000, max: 160000 },
                ];
                // Lightly adjust using growthRate to keep values sensible but dynamic
                const factor = Math.max(0.8, Math.min(1.2, 1 + (growthRate || 0) / 1000));
                salaryRanges = base.map(r => ({
                    role: r.role,
                    min: Math.round(r.min * factor),
                    median: Math.round(r.median * factor),
                    max: Math.round(r.max * factor),
                    location: "Global"
                }));
            }

            const safe = {
                salaryRanges,
                growthRate,
                demandLevel,
                topSkills: topSkills.length ? topSkills : ["Communication", "Problem Solving", "Teamwork", "Agile", "Cloud Basics"],
                marketOutlook,
                keyTrends: keyTrends.length ? keyTrends : ["AI Adoption", "Remote Work", "Cloud Migration", "Cybersecurity Focus", "Automation"],
                recommendedSkills: recommendedSkills.length ? recommendedSkills : ["Python", "SQL", "React", "Docker", "AWS"],
            };

            // Use upsert to avoid race conditions and always provide required fields
            industryInsight = await db.industryInsight.upsert({
                where: { industry: data.industry },
                update: {},
                create: {
                    industry: data.industry,
                    ...safe,
                    nextUpdate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                },
            });
        }

        // Update the user profile
        const updatedUser = await db.user.update({
            where: { id: user.id },
            data: {
                industry: data.industry,
                experience: data.experience,
                bio: data.bio,
                // Only pass skills if provided; undefined will be ignored by Prisma
                ...(typeof data.skills !== 'undefined' ? { skills: data.skills } : {}),
            },
        });

        return { success: true, updatedUser, industryInsight };
    } catch (error) {
        console.error("Error updating user and industry:", error);
        throw new Error("Failed to update profile");
    }
}

export async function getUserOnboardingStatus() {
    const {userId} = await auth();
    if (!userId) throw new Error("Unauthorized");

    // Import checkUser function
    const {checkUser} = await import("@/lib/checkUser");

    // Try to get or create the user via Clerk; fallback to direct DB lookup
    const maybeUser = await checkUser();
    const user = maybeUser || await db.user.findUnique({ where: { clerkUserId: userId } });

    try {
        return {
            // If user record doesn't exist yet, treat as not onboarded so the form can render
            isOnboarded: !!user?.industry,
        };
    } catch (error) {
        console.error("Error checking onboarding status:", error.message);
        // Fail soft: return not onboarded so UI can proceed to form
        return { isOnboarded: false };
    }
}
