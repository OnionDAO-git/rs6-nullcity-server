import type { Player } from '@engine/world/actor/player/player';
import { Skill } from '@engine/world/actor/skills';
import type { AgilityObstacle } from './agility-config';
import { getAgilityCourse } from './agility-config';

export interface AgilityCourseProgress {
    courseId: string;
    nextSequence: number;
}

interface AgilityMetadata {
    courseProgress?: AgilityCourseProgress;
}

function agilityMetadata(player: Player): AgilityMetadata {
    const metadata = player.metadata as Player['metadata'] & { agility?: AgilityMetadata };
    if (!metadata.agility) {
        metadata.agility = {};
    }
    return metadata.agility;
}

export function getAgilityProgress(player: Player): AgilityCourseProgress | undefined {
    return agilityMetadata(player).courseProgress;
}

export function resetAgilityProgress(player: Player): void {
    delete agilityMetadata(player).courseProgress;
}

export function recordAgilityObstacle(player: Player, obstacle: AgilityObstacle): boolean {
    const course = getAgilityCourse(obstacle.courseId);
    if (!course || obstacle.sequence === undefined) {
        return false;
    }

    const metadata = agilityMetadata(player);
    const progress = metadata.courseProgress;

    if (!progress || progress.courseId !== course.id || progress.nextSequence !== obstacle.sequence) {
        metadata.courseProgress = {
            courseId: course.id,
            nextSequence: obstacle.sequence === 0 ? 1 : 0,
        };
        return false;
    }

    const nextSequence = obstacle.sequence + 1;
    if (nextSequence < course.sequence.length) {
        metadata.courseProgress = { courseId: course.id, nextSequence };
        return false;
    }

    delete metadata.courseProgress;
    player.skills.addExp(Skill.AGILITY, course.lapBonusXp);
    player.sendMessage(`You completed a lap of the ${course.name}.`);
    return true;
}
