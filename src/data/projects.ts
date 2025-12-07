import type { ImageMetadata } from "astro";
import MCP from "../assets/Projects/mcp.png";
import UniInterface from "../assets/Projects/UniswapTestInterface.png";
import UniCow from "../assets/Projects/UniCoW.png";
import GCP from "../assets/Projects/gcp.png";

export type ProjectItem = {
	title: string;
	description: string;
	image: ImageMetadata;
	link: string;
	tags: string[];
};

export const projects: ProjectItem[] = [
	{
		title: "Uniswap Docs MCP",
		description:
			"With the advent of LLMs, the need for a more structured availability of docs has become pertinent. At Uniswap Foundation, I worked on building an MCP server for the Uniswap docs, which can be added to your LLMs to aid your development process.",
		image: MCP,
		link: "https://github.com/aravind33b/Uniswap_Docs_MCP",
		tags: ["developer tools", "productivity","AI", "blockchain"],
	},
	{
		title: "Uniswap v4 Test interface",
		description:
			"A minimal code setup to test the Uniswap v4 hooks in UI similar to that of the Uniswap Interface allowing users to create a hooked pool, provide liquidity and route through specific pools",
		image: UniInterface,
		link: "https://github.com/uniswapfoundation/v4-test-interface",
		tags: ["developer tools", "productivity", "blockchain"],
	},
	{
		title: "UniCoW v2",
		description:
			"v2 version of COW matching service implementation as a v4 Uniswap Hook",
		image: UniCow,
		link: "https://github.com/aravind33b/UniCowV2",
		tags: ["blockchain"],
	},
	{
		title: "Google Cloud infra setup using Terraform",
		description:
			"This project uses Terraform to automate provisioning of VPC networks, subnets, and Compute Engine instances on Google Cloud Platform (GCP). It supports creating multiple VPCs and subnets for effective resource segregation. Virtual machines are deployed with custom Packer images, ensuring standardized and consistent infrastructure.",
		image: GCP,
		link: "https://github.com/aravind33b/tf-gcp-infra",
		tags: ["cloud computing"],
	},
];
