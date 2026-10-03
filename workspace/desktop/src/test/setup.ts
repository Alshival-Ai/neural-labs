import "@testing-library/jest-dom/vitest";

import { configure } from "@testing-library/react";
// Dynamic catalog imports can take longer on the supported ARM64 development hosts.
configure({ asyncUtilTimeout: 5000 });
