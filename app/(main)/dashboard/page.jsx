import {getIndustryInsights} from "@/actions/dashboard";
import {getUserOnboardingStatus} from "@/actions/user";
import DashboardView from "./_components/dashboard-view";
import OnboardingForm from "@/app/(main)/onboarding/_components/onboarding-form";
import {industries} from "@/data/industries";

const IndustryInsightsPage = async () => {
    const {isOnboarded} = await getUserOnboardingStatus();

    if (!isOnboarded) {
        // Show onboarding form directly on the industry insights page
        return (
            <main>
                <OnboardingForm industries={industries} />
            </main>
        );
    }

    const insights = await getIndustryInsights();

    return (
        <div className="container mx-auto">
            <DashboardView insights={insights} />
        </div>
    );
};

export default IndustryInsightsPage;