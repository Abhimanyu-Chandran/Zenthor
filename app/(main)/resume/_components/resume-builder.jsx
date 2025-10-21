"use client";

import {useEffect, useState} from "react";
import {Controller, useForm} from "react-hook-form";
import {zodResolver} from "@hookform/resolvers/zod";
import {AlertTriangle, Download, Edit, Loader2, Monitor, Save,} from "lucide-react";
import {toast} from "sonner";
import MDEditor from "@uiw/react-md-editor";
import {Button} from "@/components/ui/button";
import {Tabs, TabsContent, TabsList, TabsTrigger} from "@/components/ui/tabs";
import {Textarea} from "@/components/ui/textarea";
import {Input} from "@/components/ui/input";
import {saveResume} from "@/actions/resume";
import {EntryForm} from "./entry-form";
import useFetch from "@/hooks/use-fetch";
import {useUser} from "@clerk/nextjs";
import {entriesToMarkdown} from "@/app/lib/helper";
import {resumeSchema} from "@/app/lib/schema";
// Dynamically import html2pdf only on the client to avoid SSR issues
// Note: We'll import inside generatePDF()

export default function ResumeBuilder({initialContent}) {
    const [activeTab, setActiveTab] = useState("edit");
    const [previewContent, setPreviewContent] = useState(initialContent);
    const {user} = useUser();
    const [resumeMode, setResumeMode] = useState("preview");

    const {
        control, register, handleSubmit, watch, formState: {errors},
    } = useForm({
        resolver: zodResolver(resumeSchema), defaultValues: {
            contactInfo: {}, summary: "", skills: "", experience: [], education: [], projects: [],
        },
    });

    const {
        loading: isSaving, fn: saveResumeFn, data: saveResult, error: saveError,
    } = useFetch(saveResume);

    // Watch form fields for preview updates
    const formValues = watch();

    useEffect(() => {
        if (initialContent) setActiveTab("preview");
    }, [initialContent]);

    // Update preview content when form values change
    useEffect(() => {
        if (activeTab === "edit") {
            const newContent = getCombinedContent();
            setPreviewContent(newContent ? newContent : initialContent);
        }
    }, [formValues, activeTab]);

    // Handle save result
    useEffect(() => {
        if (saveResult && !isSaving) {
            toast.success("Resume saved successfully!");
        }
    }, [saveResult, saveError, isSaving]);

    const getContactMarkdown = () => {
        const {contactInfo} = formValues;
        const parts = [];
        if (contactInfo.email) parts.push(`📧 ${contactInfo.email}`);
        if (contactInfo.mobile) parts.push(`📱 ${contactInfo.mobile}`);
        if (contactInfo.linkedin) parts.push(`💼 [LinkedIn](${contactInfo.linkedin})`);
        if (contactInfo.twitter) parts.push(`🐦 [Twitter](${contactInfo.twitter})`);

        return parts.length > 0 ? `## <div align="center">${user.fullName}</div>
        \n\n<div align="center">\n\n${parts.join(" | ")}\n\n</div>` : "";
    };

    const getCombinedContent = () => {
        const {summary, skills, experience, education, projects} = formValues;
        return [getContactMarkdown(), summary && `## Professional Summary\n\n${summary}`, skills && `## Skills\n\n${skills}`, entriesToMarkdown(experience, "Work Experience"), entriesToMarkdown(education, "Education"), entriesToMarkdown(projects, "Projects"),]
            .filter(Boolean)
            .join("\n\n");
    };

    const [isGenerating, setIsGenerating] = useState(false);

    const generatePDF = async () => {
        setIsGenerating(true);
        try {
            if (typeof window === "undefined") {
                throw new Error("PDF generation is only available in the browser");
            }

            const element = document.getElementById("resume-pdf");
            if (!element) {
                throw new Error("Resume content not found on the page");
            }

            // Dynamic import to avoid SSR/window issues
            const html2pdf = (await import("html2pdf.js")).default;

            const opt = {
                margin: [15, 15], filename: "resume.pdf", image: {type: "jpeg", quality: 0.98}, html2canvas: {
                    scale: 2, backgroundColor: "#ffffff", useCORS: true, onclone: (clonedDoc) => {
                        try {
                            // Ensure white background on the whole page
                            if (clonedDoc && clonedDoc.body) clonedDoc.body.style.background = "#ffffff";
                            const el = clonedDoc.getElementById("resume-pdf");
                            if (el) {
                                // Add a class to mark export mode (if styles use it)
                                el.classList.add("pdf-safe");
                            }
                            // Remove external styles that may include lab()/oklch()/lch()/oklab() to avoid html2canvas parse errors
                            const head = clonedDoc.head;
                            if (head) {
                                // Remove all <link rel="stylesheet"> tags
                                const links = Array.from(head.querySelectorAll('link[rel="stylesheet"]'));
                                links.forEach((n) => n.parentNode && n.parentNode.removeChild(n));
                                // Remove all existing <style> tags (we'll inject our own safe stylesheet next)
                                const styles = Array.from(head.querySelectorAll('style'));
                                styles.forEach((n) => n.parentNode && n.parentNode.removeChild(n));
                            }

                            // Inject a minimal safe stylesheet (RGB/HSL only) scoped to #resume-pdf
                            const style = clonedDoc.createElement("style");
                            style.setAttribute("data-injected", "pdf-safe");
                            style.textContent = `
                              :root {
                                /* Force sane defaults for libs that read CSS variables */
                                --background: 255 255 255 !important;
                                --foreground: 0 0 0 !important;
                                --muted: 245 245 245 !important;
                                --muted-foreground: 17 17 17 !important;
                              }
                              html, body { background: #ffffff !important; color: #000000 !important; }
                              #resume-pdf, #resume-pdf * {
                                background: #ffffff !important;
                                color: #000000 !important;
                                border-color: #000000 !important;
                                box-shadow: none !important;
                                text-shadow: none !important;
                              }
                              #resume-pdf h1, #resume-pdf h2, #resume-pdf h3, #resume-pdf h4, #resume-pdf h5, #resume-pdf h6 { color: #000000 !important; }
                              #resume-pdf a { color: #0000EE !important; text-decoration: underline; }
                              #resume-pdf a:visited { color: #551A8B !important; }
                              #resume-pdf pre, #resume-pdf code { background: #f5f5f5 !important; color: #111111 !important; }
                              #resume-pdf table { border-collapse: collapse !important; }
                              #resume-pdf th, #resume-pdf td { border: 1px solid #000000 !important; padding: 4px !important; }
                            `;
                            clonedDoc.head && clonedDoc.head.appendChild(style);
                        } catch (e) {
                            // noop
                        }
                    },
                }, jsPDF: {unit: "mm", format: "a4", orientation: "portrait"},
            };

            await html2pdf().set(opt).from(element).save();
        } catch (error) {
            console.error("PDF generation error:", error);
            toast.error("Failed to generate PDF. Please try again.");
        } finally {
            setIsGenerating(false);
        }
    };

    const onSubmit = async (data) => {
        try {
            const formattedContent = previewContent
                .replace(/\n/g, "\n") // Normalize newlines
                .replace(/\n\s*\n/g, "\n\n") // Normalize multiple newlines to double newlines
                .trim();

            console.log(previewContent, formattedContent);
            await saveResumeFn(previewContent);
        } catch (error) {
            console.error("Save error:", error);
        }
    };

    return (<div data-color-mode="light" className="space-y-4">
        <div className="flex flex-col md:flex-row justify-between items-center gap-2">
            <h1 className="font-bold gradient-title text-5xl md:text-6xl">
                Resume Builder
            </h1>
            <div className="space-x-2">
                <Button
                    variant="destructive"
                    onClick={handleSubmit(onSubmit)}
                    disabled={isSaving}
                >
                    {isSaving ? (<>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin"/>
                        Saving...
                    </>) : (<>
                        <Save className="h-4 w-4"/>
                        Save
                    </>)}
                </Button>
                <Button onClick={generatePDF} disabled={isGenerating}>
                    {isGenerating ? (<>
                        <Loader2 className="h-4 w-4 animate-spin"/>
                        Generating PDF...
                    </>) : (<>
                        <Download className="h-4 w-4"/>
                        Download PDF
                    </>)}
                </Button>
            </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
                <TabsTrigger value="edit">Form</TabsTrigger>
                <TabsTrigger value="preview">Markdown</TabsTrigger>
            </TabsList>

            <TabsContent value="edit">
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
                    {/* Contact Information */}
                    <div className="space-y-4">
                        <h3 className="text-lg font-medium">Contact Information</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 border rounded-lg bg-muted/50">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Email</label>
                                <Input
                                    {...register("contactInfo.email")}
                                    type="email"
                                    placeholder="your@email.com"
                                    error={errors.contactInfo?.email}
                                />
                                {errors.contactInfo?.email && (<p className="text-sm text-red-500">
                                    {errors.contactInfo.email.message}
                                </p>)}
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Mobile Number</label>
                                <Input
                                    {...register("contactInfo.mobile")}
                                    type="tel"
                                    placeholder="+1 234 567 8900"
                                />
                                {errors.contactInfo?.mobile && (<p className="text-sm text-red-500">
                                    {errors.contactInfo.mobile.message}
                                </p>)}
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">LinkedIn URL</label>
                                <Input
                                    {...register("contactInfo.linkedin")}
                                    type="url"
                                    placeholder="https://linkedin.com/in/your-profile"
                                />
                                {errors.contactInfo?.linkedin && (<p className="text-sm text-red-500">
                                    {errors.contactInfo.linkedin.message}
                                </p>)}
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">
                                    Twitter/X Profile
                                </label>
                                <Input
                                    {...register("contactInfo.twitter")}
                                    type="url"
                                    placeholder="https://twitter.com/your-handle"
                                />
                                {errors.contactInfo?.twitter && (<p className="text-sm text-red-500">
                                    {errors.contactInfo.twitter.message}
                                </p>)}
                            </div>
                        </div>
                    </div>

                    {/* Summary */}
                    <div className="space-y-4">
                        <h3 className="text-lg font-medium">Professional Summary</h3>
                        <Controller
                            name="summary"
                            control={control}
                            render={({field}) => (<Textarea
                                {...field}
                                className="h-32"
                                placeholder="Write a compelling professional summary..."
                                error={errors.summary}
                            />)}
                        />
                        {errors.summary && (<p className="text-sm text-red-500">{errors.summary.message}</p>)}
                    </div>

                    {/* Skills */}
                    <div className="space-y-4">
                        <h3 className="text-lg font-medium">Skills</h3>
                        <Controller
                            name="skills"
                            control={control}
                            render={({field}) => (<Textarea
                                {...field}
                                className="h-32"
                                placeholder="List your key skills..."
                                error={errors.skills}
                            />)}
                        />
                        {errors.skills && (<p className="text-sm text-red-500">{errors.skills.message}</p>)}
                    </div>

                    {/* Experience */}
                    <div className="space-y-4">
                        <h3 className="text-lg font-medium">Work Experience</h3>
                        <Controller
                            name="experience"
                            control={control}
                            render={({field}) => (<EntryForm
                                type="Experience"
                                entries={field.value}
                                onChange={field.onChange}
                            />)}
                        />
                        {errors.experience && (<p className="text-sm text-red-500">
                            {errors.experience.message}
                        </p>)}
                    </div>

                    {/* Education */}
                    <div className="space-y-4">
                        <h3 className="text-lg font-medium">Education</h3>
                        <Controller
                            name="education"
                            control={control}
                            render={({field}) => (<EntryForm
                                type="Education"
                                entries={field.value}
                                onChange={field.onChange}
                            />)}
                        />
                        {errors.education && (<p className="text-sm text-red-500">
                            {errors.education.message}
                        </p>)}
                    </div>

                    {/* Projects */}
                    <div className="space-y-4">
                        <h3 className="text-lg font-medium">Projects</h3>
                        <Controller
                            name="projects"
                            control={control}
                            render={({field}) => (<EntryForm
                                type="Project"
                                entries={field.value}
                                onChange={field.onChange}
                            />)}
                        />
                        {errors.projects && (<p className="text-sm text-red-500">
                            {errors.projects.message}
                        </p>)}
                    </div>
                </form>
            </TabsContent>

            <TabsContent value="preview">
                {activeTab === "preview" && (<Button
                    variant="link"
                    type="button"
                    className="mb-2"
                    onClick={() => setResumeMode(resumeMode === "preview" ? "edit" : "preview")}
                >
                    {resumeMode === "preview" ? (<>
                        <Edit className="h-4 w-4"/>
                        Edit Resume
                    </>) : (<>
                        <Monitor className="h-4 w-4"/>
                        Show Preview
                    </>)}
                </Button>)}

                {activeTab === "preview" && resumeMode !== "preview" && (<div
                    className="flex p-3 gap-2 items-center border-2 border-yellow-600 text-yellow-600 rounded mb-2">
                    <AlertTriangle className="h-5 w-5"/>
                    <span className="text-sm">
                You will lose editied markdown if you update the form data.
              </span>
                </div>)}
                <div className="border rounded-lg">
                    <MDEditor
                        value={previewContent}
                        onChange={setPreviewContent}
                        height={800}
                        preview={resumeMode}
                    />
                </div>
                <div className="hidden">
                    <div id="resume-pdf">
                        <style>
                            {`
                            /* Force simple colors for html2canvas to avoid lab()/oklab parsing errors */
                            #resume-pdf, #resume-pdf * {
                              color: #000 !important;
                              background: #fff !important;
                              border-color: #000 !important;
                              box-shadow: none !important;
                              text-shadow: none !important;
                            }
                            /* Links */
                            #resume-pdf a { color: #0000EE !important; }
                            #resume-pdf a:visited { color: #551A8B !important; }
                            /* Code blocks */
                            #resume-pdf pre, #resume-pdf code { background: #f5f5f5 !important; color: #111 !important; }
                            `}
                        </style>
                        <MDEditor.Markdown
                            source={previewContent}
                            style={{
                                background: "white", color: "black",
                            }}
                        />
                    </div>
                </div>
            </TabsContent>
        </Tabs>
    </div>);
}