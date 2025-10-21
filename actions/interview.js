"use server";

import {db} from "@/lib/prisma";
import {auth} from "@clerk/nextjs/server";
import {GoogleGenerativeAI} from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({model: "gemini-1.5-flash"});

export async function generateQuiz() {
    const {userId} = await auth();
    if (!userId) throw new Error("Unauthorized");

    const user = await db.user.findUnique({
        where: {clerkUserId: userId},
        select: {
            industry: true,
            skills: true,
        },
    });

    if (!user) throw new Error("User not found");

    const makeFallback = () => {
        const domain = user.industry || "your field";
        const skillsText = user.skills?.length ? ` related to ${user.skills.join(", ")}` : "";
        // 10 simple, generic multiple-choice questions
        const templates = [
            {
                q: `Which of the following is a best practice in ${domain}${skillsText}?`,
                opts: [
                    "Write untested code",
                    "Use clear naming and documentation",
                    "Commit secrets to version control",
                    "Ignore performance entirely",
                ],
                correct: "Use clear naming and documentation",
                exp: `Clear naming and documentation improves maintainability in ${domain}.`,
            },
            {
                q: `When approaching a new problem in ${domain}, what should you do first?`,
                opts: [
                    "Start coding immediately",
                    "Define the requirements and constraints",
                    "Choose the fanciest tool",
                    "Copy a random solution online",
                ],
                correct: "Define the requirements and constraints",
                exp: "Understanding the problem prevents rework and guides solution design.",
            },
            {
                q: `Which option best describes effective collaboration on a project in ${domain}?`,
                opts: [
                    "Avoid code reviews",
                    "Provide timely feedback and communicate changes",
                    "Work in isolation",
                    "Skip documenting decisions",
                ],
                correct: "Provide timely feedback and communicate changes",
                exp: "Good collaboration reduces misunderstandings and defects.",
            },
            {
                q: `What is the primary benefit of breaking work into smaller tasks in ${domain}?`,
                opts: [
                    "It hides progress",
                    "It makes estimation and tracking easier",
                    "It increases context switching",
                    "It guarantees no bugs",
                ],
                correct: "It makes estimation and tracking easier",
                exp: "Smaller tasks improve focus and delivery predictability.",
            },
            {
                q: `In ${domain}, why is validating inputs important?`,
                opts: [
                    "To make code longer",
                    "To prevent errors and security issues",
                    "To slow down the system",
                    "To avoid writing tests",
                ],
                correct: "To prevent errors and security issues",
                exp: "Validation reduces runtime failures and vulnerabilities.",
            },
            {
                q: `What does choosing the simplest solution that works encourage?`,
                opts: [
                    "Over-engineering",
                    "Maintainability and clarity",
                    "Vendor lock-in",
                    "Unlimited scope creep",
                ],
                correct: "Maintainability and clarity",
                exp: "Simple solutions are easier to maintain and adapt.",
            },
            {
                q: `Which metric is most useful to evaluate quality in ${domain}?`,
                opts: [
                    "Number of lines written",
                    "Outcomes and user impact",
                    "Number of buzzwords used",
                    "Amount of time spent",
                ],
                correct: "Outcomes and user impact",
                exp: "Value delivered matters more than volume of output.",
            },
            {
                q: `What should you do when requirements change mid-project?`,
                opts: [
                    "Ignore changes",
                    "Communicate impact and adapt the plan",
                    "Panic and rewrite everything",
                    "Blame the customer",
                ],
                correct: "Communicate impact and adapt the plan",
                exp: "Transparency helps re-align scope, timeline, and priorities.",
            },
            {
                q: `Why is measuring performance important in ${domain}${skillsText}?`,
                opts: [
                    "To make dashboards look impressive",
                    "To identify bottlenecks and improve efficiency",
                    "To justify over-engineering",
                    "It is not important",
                ],
                correct: "To identify bottlenecks and improve efficiency",
                exp: "Metrics guide targeted improvements.",
            },
            {
                q: `What is a safe practice when handling sensitive data in ${domain}?`,
                opts: [
                    "Store secrets in plain text",
                    "Share credentials over chat",
                    "Use proper encryption and access controls",
                    "Commit keys to repositories",
                ],
                correct: "Use proper encryption and access controls",
                exp: "Security best practices protect users and organizations.",
            },
        ];
        return templates.map((t) => ({
            question: t.q,
            options: t.opts,
            correctAnswer: t.correct,
            explanation: t.exp,
        }));
    };

    const prompt = `
    Generate 10 technical interview questions for a ${
        user.industry
    } professional${
        user.skills?.length ? ` with expertise in ${user.skills.join(", ")}` : ""
    }.
    
    Each question should be multiple choice with 4 options.
    
    Return the response in this JSON format only, no additional text:
    {
      "questions": [
        {
          "question": "string",
          "options": ["string", "string", "string", "string"],
          "correctAnswer": "string",
          "explanation": "string"
        }
      ]
    }
  `;

    try {
        const result = await model.generateContent(prompt);
        const response = result.response;
        const text = response.text();
        const cleanedText = text.replace(/```(?:json)?\n?/g, "").trim();
        const parsed = JSON.parse(cleanedText);
        const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];
        if (!questions.length) {
            return makeFallback();
        }
        // Ensure each question has required fields
        return questions.map((q) => ({
            question: q.question || "Question",
            options: Array.isArray(q.options) && q.options.length === 4 ? q.options : ["A", "B", "C", "D"],
            correctAnswer: q.correctAnswer || (Array.isArray(q.options) ? q.options[0] : "A"),
            explanation: q.explanation || "",
        }));
    } catch (error) {
        console.error("Error generating quiz:", error);
        // Fallback to locally generated questions to satisfy requirement
        return makeFallback();
    }
}

export async function saveQuizResult(questions, answers, score) {
    const {userId} = await auth();
    if (!userId) throw new Error("Unauthorized");

    const user = await db.user.findUnique({
        where: {clerkUserId: userId},
    });

    if (!user) throw new Error("User not found");

    const questionResults = questions.map((q, index) => ({
        question: q.question,
        answer: q.correctAnswer,
        userAnswer: answers[index],
        isCorrect: q.correctAnswer === answers[index],
        explanation: q.explanation,
    }));

    // Get wrong answers
    const wrongAnswers = questionResults.filter((q) => !q.isCorrect);

    // Only generate improvement tips if there are wrong answers
    let improvementTip = null;
    if (wrongAnswers.length > 0) {
        const wrongQuestionsText = wrongAnswers
            .map(
                (q) =>
                    `Question: "${q.question}"\nCorrect Answer: "${q.answer}"\nUser Answer: "${q.userAnswer}"`
            )
            .join("\n\n");

        const improvementPrompt = `
      The user got the following ${user.industry} technical interview questions wrong:

      ${wrongQuestionsText}

      Based on these mistakes, provide a concise, specific improvement tip.
      Focus on the knowledge gaps revealed by these wrong answers.
      Keep the response under 2 sentences and make it encouraging.
      Don't explicitly mention the mistakes, instead focus on what to learn/practice.
    `;

        try {
            const tipResult = await model.generateContent(improvementPrompt);

            improvementTip = tipResult.response.text();
            console.log(improvementTip);
        } catch (error) {
            console.error("Error generating improvement tip:", error);
            // Continue without improvement tip if generation fails
        }
    }

    try {
        return await db.assessment.create({
            data: {
                userId: user.id,
                quizScore: score,
                questions: questionResults,
                category: "Technical",
                improvementTip,
            },
        });
    } catch (error) {
        console.error("Error saving quiz result:", error);
        throw new Error("Failed to save quiz result");
    }
}

export async function getAssessments() {
    const {userId} = await auth();
    if (!userId) throw new Error("Unauthorized");

    const user = await db.user.findUnique({
        where: {clerkUserId: userId},
    });

    if (!user) throw new Error("User not found");

    try {
        return await db.assessment.findMany({
            where: {
                userId: user.id,
            },
            orderBy: {
                createdAt: "asc",
            },
        });
    } catch (error) {
        console.error("Error fetching assessments:", error);
        throw new Error("Failed to fetch assessments");
    }
}