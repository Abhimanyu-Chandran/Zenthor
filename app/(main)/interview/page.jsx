import React from 'react';
import {getAssessments} from "@/actions/interview";
import StatsCards from "@/app/(main)/interview/_components/stats-cards";
import PerformanceChart from "@/app/(main)/interview/_components/performance-chart";
import QuizList from "@/app/(main)/interview/_components/quiz-list";

const InterviewPage = async () => {
    const assessments = await getAssessments()

    return (<div>
        <h1 className="text-6xl font-bold gradient-title mb-5">
            Interview Preparation
        </h1>

        <div className="space-y-6">
            <StatsCards assessments={assessments}/>
            <PerformanceChart assessments={assessments}/>
            <QuizList assessments={assessments}/>
        </div>
    </div>);
};

export default InterviewPage;