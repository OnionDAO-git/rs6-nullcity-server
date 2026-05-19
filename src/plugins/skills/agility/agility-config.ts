import { objectIds } from '@engine/world/config/object-ids';

export interface AgilityRouteStep {
    x: number;
    y: number;
    level?: number;
}

export interface AgilityFailConfig {
    chance: number;
    minChance?: number;
    levelReduction?: number;
    damage?: number;
    route?: AgilityRouteStep[];
    message?: string;
}

export interface AgilityObstacle {
    key: string;
    objectIds: number[];
    options: string[];
    level: number;
    xp: number;
    animation?: number;
    ticks?: number;
    route: AgilityRouteStep[];
    courseId?: string;
    sequence?: number;
    fail?: AgilityFailConfig;
    successMessage?: string;
}

export interface AgilityCourse {
    id: string;
    name: string;
    sequence: string[];
    lapBonusXp: number;
}

export const agilityObstacleAnimations = {
    climb: 828,
    balance: 762,
    crawl: 844,
    jump: 741,
    squeeze: 749,
    ropeSwing: 751,
};

export const agilityObstacles: AgilityObstacle[] = [
    {
        key: 'gnome_log_balance',
        objectIds: [2295],
        options: ['walk-across', 'walk across', 'balance'],
        level: 1,
        xp: 7.5,
        animation: agilityObstacleAnimations.balance,
        route: [{ x: 0, y: -7 }],
        courseId: 'gnome_stronghold',
        sequence: 0,
        successMessage: 'You walk carefully across the log.',
    },
    {
        key: 'gnome_obstacle_net_1',
        objectIds: [2285],
        options: ['climb-over', 'climb over', 'climb'],
        level: 1,
        xp: 7.5,
        animation: agilityObstacleAnimations.climb,
        route: [{ x: 0, y: 2, level: 1 }],
        courseId: 'gnome_stronghold',
        sequence: 1,
    },
    {
        key: 'gnome_tree_branch_up',
        objectIds: [2313],
        options: ['climb', 'climb-up', 'climb up'],
        level: 1,
        xp: 5,
        animation: agilityObstacleAnimations.climb,
        route: [{ x: 0, y: 0, level: 2 }],
        courseId: 'gnome_stronghold',
        sequence: 2,
    },
    {
        key: 'gnome_balancing_rope',
        objectIds: [2312],
        options: ['walk-on', 'walk on', 'balance'],
        level: 1,
        xp: 7.5,
        animation: agilityObstacleAnimations.ropeSwing,
        route: [{ x: 6, y: 0 }],
        courseId: 'gnome_stronghold',
        sequence: 3,
    },
    {
        key: 'gnome_tree_branch_down',
        objectIds: [2314],
        options: ['climb-down', 'climb down', 'climb'],
        level: 1,
        xp: 5,
        animation: agilityObstacleAnimations.climb,
        route: [{ x: 0, y: 0, level: 0 }],
        courseId: 'gnome_stronghold',
        sequence: 4,
    },
    {
        key: 'gnome_obstacle_net_2',
        objectIds: [2286],
        options: ['climb-over', 'climb over', 'climb'],
        level: 1,
        xp: 7.5,
        animation: agilityObstacleAnimations.climb,
        route: [{ x: 0, y: 2 }],
        courseId: 'gnome_stronghold',
        sequence: 5,
    },
    {
        key: 'gnome_obstacle_pipe',
        objectIds: [154],
        options: ['squeeze-through', 'squeeze through', 'crawl-through', 'crawl through'],
        level: 1,
        xp: 7.5,
        animation: agilityObstacleAnimations.crawl,
        route: [{ x: 0, y: 3 }],
        courseId: 'gnome_stronghold',
        sequence: 6,
    },
    {
        key: 'al_kharid_fence_shortcut',
        objectIds: [objectIds.shortCuts.fenceNearKharidCows],
        options: ['climb-over', 'climb over', 'jump-over', 'jump over'],
        level: 1,
        xp: 0.5,
        animation: agilityObstacleAnimations.jump,
        route: [{ x: 0, y: 2 }],
        fail: {
            chance: 0.2,
            minChance: 0.03,
            levelReduction: 0.006,
            damage: 1,
            message: 'You slip while attempting the shortcut.',
        },
    },
    {
        key: 'stile_shortcut',
        objectIds: [objectIds.shortCuts.stile],
        options: ['climb-over', 'climb over', 'climb'],
        level: 1,
        xp: 0.5,
        animation: agilityObstacleAnimations.climb,
        route: [{ x: 0, y: 1 }],
    },
];

export const agilityCourses: AgilityCourse[] = [
    {
        id: 'gnome_stronghold',
        name: 'Gnome Stronghold Agility Course',
        sequence: [
            'gnome_log_balance',
            'gnome_obstacle_net_1',
            'gnome_tree_branch_up',
            'gnome_balancing_rope',
            'gnome_tree_branch_down',
            'gnome_obstacle_net_2',
            'gnome_obstacle_pipe',
        ],
        lapBonusXp: 39,
    },
];

export const agilityObstacleIds = [...new Set(agilityObstacles.flatMap(obstacle => obstacle.objectIds))];

export function getAgilityObstacle(objectId: number, option: string): AgilityObstacle | undefined {
    const normalizedOption = option.toLowerCase().replace(/-/g, ' ');
    return agilityObstacles.find(
        obstacle =>
            obstacle.objectIds.includes(objectId) &&
            obstacle.options.some(configuredOption => configuredOption.toLowerCase().replace(/-/g, ' ') === normalizedOption),
    );
}

export function getAgilityCourse(courseId: string | undefined): AgilityCourse | undefined {
    return courseId ? agilityCourses.find(course => course.id === courseId) : undefined;
}
