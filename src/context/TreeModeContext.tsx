import React, { createContext, useContext, useState, useCallback } from 'react';

export type TreeMode = 'empty' | 'my' | 'max';

interface TreeModeContextType {
    treeMode: TreeMode;
    setTreeMode: (mode: TreeMode) => void;
    cycleTreeMode: () => void;
    activeTree?: any;
    simulatedTree?: any;
}

const TreeModeContext = createContext<TreeModeContextType | undefined>(undefined);

export const TreeModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [treeMode, setTreeMode] = useState<TreeMode>('my');

    const cycleTreeMode = useCallback(() => {
        setTreeMode(prev => {
            if (prev === 'empty') return 'my';
            if (prev === 'my') return 'max';
            return 'empty';
        });
    }, []);

    return (
        <TreeModeContext.Provider value={{ treeMode, setTreeMode, cycleTreeMode }}>
            {children}
        </TreeModeContext.Provider>
    );
};

export const useTreeMode = () => {
    const context = useContext(TreeModeContext);
    if (context === undefined) {
        throw new Error('useTreeMode must be used within a TreeModeProvider');
    }
    return context;
};
