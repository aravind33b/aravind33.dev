import type { ImageMetadata } from "astro";
import LVV from "../assets/Awards/LVV.jpg";
import UHI from "../assets/Awards/UHI.jpg";
import HBC from "../assets/Awards/HBC.jpg";

export type AwardItem = {
    title: string;
    description: string;
    image: ImageMetadata;
};

export const awards: AwardItem[] = [
    {
        title: "Lux.Veritas.Virtus Society of Distinction",
        description:
            "Awarded to the top 75 graduating Masters students at Northeastern University, this award is a testament to my contributions to the betterment of Northeastern's student community as a student leader through my work as the Vice President of Graduate Student Government and overall academic excellence",
        image: LVV,
    },
    {
        title: "Uniswap Hook Incubator",
        description:
            "Won best use of EigenLayer AVS at Uniswap Hook Incubator for my Coincidence of Wants based v4 Hook implementation",
        image: UHI,
    },
    {
        title: "Harvard Blockchain Conference 2023",
        description:
            "Won 2nd place at Harvard Blockchain Conference 2023 for best use case of Axelar's interoperable cross chain network",
        image: HBC,
    },
];
