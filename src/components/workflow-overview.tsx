import Link from "next/link";
import { T } from "@/components/language-provider";

export function WorkflowOverview({ hasContent, hasGroups, hasDevice }: {
  hasContent: boolean; hasGroups: boolean; hasDevice: boolean;
}) {
  const steps = [
    { title: "Prepare content", description: "Save a caption and its images for reuse.", href: "/content", ready: hasContent },
    { title: "Add your groups", description: "Keep the groups you want to reach in one place.", href: "/groups", ready: hasGroups },
    { title: "Pair your browser", description: "Connect the extension that prepares your Facebook posts.", href: "/settings#extension", ready: hasDevice },
    { title: "Create a campaign", description: "Choose content, select groups and set your timing.", href: "/campaigns#new", ready: false },
  ];
  const nextIndex = steps.findIndex((step) => !step.ready);
  return (
    <section className="workflow-overview" aria-labelledby="workflow-heading">
      <div className="workflow-heading">
        <div><span className="eyebrow"><T>{"Your next step"}</T></span><h2 id="workflow-heading"><T>{steps[nextIndex].title}</T></h2></div>
        <p><T>{"A clear path from your first caption to your next campaign."}</T></p>
      </div>
      <ol className="workflow-grid">
        {steps.map((step, index) => <li key={step.href}>
          <Link href={step.href} className={index === nextIndex ? "workflow-step is-next" : "workflow-step"}>
            <div className="row"><span className="step-number">{index + 1}</span><span className={`badge ${step.ready ? "green" : index === nextIndex ? "blue" : ""}`}><T>{step.ready ? "Ready" : index === nextIndex ? "Up next" : "To do"}</T></span></div>
            <strong><T>{step.title}</T></strong><p><T>{step.description}</T></p>
            <span className="text-action"><T>{step.ready ? "Manage" : "Get started"}</T></span>
          </Link>
        </li>)}
      </ol>
    </section>
  );
}
