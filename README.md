# Forge Master Wiki & Calculator (FM)

![Forge Master Logo](./public/Texture2D/TechTreeForge.png)

A comprehensive, **100% Fanmade** toolkit and encyclopedia for Forge Master players. This project provides real-time calculators, a persistent profile system, and an exhaustive database sourced directly from the game's official configuration files.

## 🚀 Project Links
- **Live Tool**: [1vcian.me/fm](https://1vcian.me)
- **GitHub Repository**: [1vcian/fm](https://github.com/1vcian/fm)
- **Support the Project**: [Buy Me a Coffee](https://www.buymeacoffee.com/1vcian)

---

## 📂 Features Overview

The application is divided into four main sections within the sidebar, each designed to optimize your gameplay and progression strategy.

### 👤 Profile Management
*Manage your game state and test "what-if" scenarios.*
- **My Profile**: The central hub where you define your current level, equipment, and research. Supports creating multiple profiles, cloning them, and sharing them via compressed URL strings.
- **Progress Prediction**: Uses your current stats to forecast future growth and resource accumulation over time.
- **PVP Simulator**: Build custom opponents and simulate combat encounters to test the effectiveness of different skill sets and equipment combinations.

### 🧮 Calculators
*Crunch the numbers for maximum efficiency.*
- **Offline Calculator**: Estimates your Coin and Hammer earnings while away. It automatically integrates bonuses from your Tech Tree and profile modifiers.
- **Dungeons**: Calculate completion requirements and rewards for various dungeon tiers including Hammer Thief, Ghost Town, and Invasion.
- **Forge Calculator**: A precise simulator for equipment production. Predict costs and success rates for different forging levels.
- **Tech Tree Simulator**: A powerful planning tool. Mock-research nodes to see their impact on your global stats. Features dependency validation (you can't skip prerequisites) and recursive pruning (resetting a parent resets its children).
- **Eggs & Pets**: Odds calculator for hatching and planning pet collection strategies.
- **Skills & Mounts**: Analyze the combat impact of leveling up specific skills or mount rarities.

### 📚 Wiki (Encyclopedia)
*The ultimate database for Forge Master mechanics.*
- **Items**: View base stats, attack ranges, and projectile speeds for all weapons and armor. Includes technical data often hidden in-game.
- **Pets & Mounts**: A complete library of every companion, including their secondary skills, base health/damage scaling, and rarity-based unlocks.
- **Skills**: Detailed descriptions and scaling factors for every active and passive skill.
- **Tech Tree**: A browseable database of all research nodes across all ages (Primitive to Divine).
- **Arena**: A guide to league tiers (Bronze to Master) including point requirements and ranking rewards.
- **Guild War**: A dynamic day-by-day guide (Monday–Saturday) showing daily preparation tasks, personal WarPoints, and the strategic Victory Points for each guild battle.

### ℹ️ Info & Project Meta
- **Unlocks**: A progression timeline showing exactly when game features (Auto Forge, Arena, Pets, etc.) become available based on your Age and Stage.
- **Colors**: A reference guide for the game's UI and rarity color palette.
- **Configs**: A raw, technical view of the parsed JSON files that power this entire tool.
- **Project Information**: Credits, developer contact for bug reporting (`medrihanlucian@gmail.com`), and special thanks to contributors.

---

## 🛠 Technical Details
- **Framework**: Built with **React** and **Vite** for lightning-fast performance.
- **Styling**: Modern, premium UI utilizing **Tailwind CSS** and glassmorphism effects.
- **Data Source**: This tool parses the game's official `.json` configs to ensure 100% data accuracy.
- **Persistence**: Your profiles are saved locally in your browser and can be exported/shared via **LZ-String** compressed links.
- **Mobile Optimized**: Every page is designed with a "Mobile-First" approach, featuring responsive headers, detailed overlays, and touch-friendly controls.

## 🤝 Credits & Contribution
Developed with ❤️ by **1vcian**.

Special thanks to **Timbo** for his invaluable contribution to debugging, technical development, and community support that helped shape this tool into what it is today.

---

*Disclaimer: This project is not affiliated with the official developers of Forge Master. It is a community-driven initiative.*
