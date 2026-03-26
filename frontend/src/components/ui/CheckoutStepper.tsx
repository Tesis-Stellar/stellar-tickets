import { Check } from "lucide-react";

const steps = [
  { label: "Datos del Comprador", number: 1 },
  { label: "Pago", number: 2 },
  { label: "Confirmación", number: 3 },
];

export const CheckoutStepper = ({ currentStep }: { currentStep: number }) => (
  <div className="flex items-center justify-center gap-0 w-full max-w-lg mx-auto mb-8">
    {steps.map((step, i) => (
      <div key={step.number} className="flex items-center flex-1 last:flex-none">
        <div className="flex flex-col items-center">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-colors ${
              currentStep > step.number
                ? "bg-success text-success-foreground"
                : currentStep === step.number
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground"
            }`}
          >
            {currentStep > step.number ? <Check className="w-5 h-5" /> : step.number}
          </div>
          <span className="text-[10px] md:text-xs font-medium text-muted-foreground mt-1.5 text-center whitespace-nowrap">
            {step.label}
          </span>
        </div>
        {i < steps.length - 1 && (
          <div
            className={`flex-1 h-0.5 mx-2 mt-[-18px] ${
              currentStep > step.number ? "bg-success" : "bg-border"
            }`}
          />
        )}
      </div>
    ))}
  </div>
);
