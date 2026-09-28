import { Link } from "@tanstack/react-router";
import useProjectStore from "@/store/project";

type LogoProps = {
  className?: string;
};

export function Logo({ className = "" }: LogoProps) {
  const { setProject } = useProjectStore();

  return (
    <Link
      onClick={() => {
        setProject(undefined);
      }}
      to="/dashboard"
      className={`flex w-auto items-center gap-2 ${className}`}
    >
      <img
        src="/logo-dark.svg"
        alt="Panda Project"
        className="h-6 w-auto dark:hidden"
      />
      <img
        src="/logo-light.svg"
        alt="Panda Project"
        className="hidden h-6 w-auto dark:block"
      />
      <span className="text-base font-semibold tracking-tight">
        Panda Project
      </span>
    </Link>
  );
}
