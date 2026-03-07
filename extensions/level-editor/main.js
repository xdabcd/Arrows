'use strict';

const path = require('path');
const fs = require('fs');

exports.methods = {
    writeLevels(arg0, arg1) {
        const jsonStr = typeof arg0 === 'string' ? arg0 : arg1;
        if (typeof jsonStr !== 'string') return;
        try {
            const projectPath = Editor.Project.path;
            const filePath = path.join(projectPath, 'assets', 'resources', 'conf', 'levels.json');
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(filePath, jsonStr, 'utf8');
            console.log('[level-editor] 已保存到', filePath);
        } catch (err) {
            console.error('[level-editor] 写入失败', err);
        }
    }
};

exports.load = function() {};
exports.unload = function() {};
