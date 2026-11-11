"""
Utility script to synchronize 13. TRN -> 13. IRN and other role/module renames into
the production compiled distribution bundles in dist/assets/.
"""
import re

def update_bundle(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        code = f.read()

    # Track baseline balance
    baseline_curly_diff = code.count('{') - code.count('}')
    baseline_paren_diff = code.count('(') - code.count(')')
    baseline_bracket_diff = code.count('[') - code.count(']')

    replacements = [
        # 1. Role permissions
        (
            '"QC (TRN)":{...y,canEditProduction:!0,allowedMilestones:[`trn`]},"Stores (Shipment)"',
            '"QC (IRN)":{...y,canEditProduction:!0,allowedMilestones:[`trn`]},"QC (TRN)":{...y,canEditProduction:!0,allowedMilestones:[`trn`]},"Stores (Shipment)"'
        ),
        # 2. Mock / template milestone names (all occurrences)
        (
            'milestoneName:`13. TRN`',
            'milestoneName:`13. IRN`'
        ),
        # 3. Stage definitions
        (
            'name:`13. TRN`,durationDays:1',
            'name:`13. IRN`,durationDays:1'
        ),
        # 4. Roles list in Sidebar ALL_ROLES
        (
            '`QC (Painting)`,`QC (TRN)`,`Stores (Shipment)`',
            '`QC (Painting)`,`QC (IRN)`,`Stores (Shipment)`'
        ),
        # 5. ROLE_BADGE in Sidebar
        (
            '"QC (TRN)":`bg-red-100 text-red-800 border-red-300`',
            '"QC (IRN)":`bg-red-100 text-red-800 border-red-300`,"QC (TRN)":`bg-red-100 text-red-800 border-red-300`'
        ),
        # 6. ROLE_RESPONSIBLE_MODULE and ROLE_MODULE_MAP
        (
            '"QC (TRN)":`13. TRN`',
            '"QC (IRN)":`13. IRN`,"QC (TRN)":`13. IRN`'
        ),
        # 7. Sidebar nav items
        (
            '{name:`13. TRN`,icon:(0,J.jsx)(Jt,{className:`w-4 h-4`}),step:`13`}',
            '{name:`13. IRN`,icon:(0,J.jsx)(Jt,{className:`w-4 h-4`}),step:`13`}'
        ),
        # 8. Friendly stage name
        (
            'case`trn`:return`13. TRN`',
            'case`trn`:case`irn`:return`13. IRN`'
        ),
        # 9. Labels in PODetailDrawer & MilestoneModuleView
        (
            '{key:`trn`,label:`13. TRN`}',
            '{key:`trn`,label:`13. IRN`}'
        ),
        # 10. CSV import stage standard name & colHeader
        (
            '{stage:13,key:`trn`,name:`13. TRN`',
            '{stage:13,key:`trn`,name:`13. IRN`'
        ),
        # 11. CSV Aliases
        (
            '13:[`TRN Actual`,`TRN Date`,`Test Report Notice`,`TRN Complete`,`TRN`]',
            '13:[`IRN Actual`,`IRN Date`,`Inspection Release Note`,`IRN Complete`,`IRN`,`TRN Actual`,`TRN Date`,`Test Report Notice`,`TRN Complete`,`TRN`]'
        ),
        (
            '13:[`S13_TRN_Planned`,`TRN Planned`,`Test Report Notice Planned`,`TRN Target`]',
            '13:[`S13_IRN_Planned`,`IRN Planned`,`Inspection Release Note Planned`,`IRN Target`,`S13_TRN_Planned`,`TRN Planned`,`Test Report Notice Planned`,`TRN Target`]'
        ),
        (
            '13:[`S13_TRN_Delay`,`TRN Delay`]',
            '13:[`S13_IRN_Delay`,`IRN Delay`,`S13_TRN_Delay`,`TRN Delay`]'
        ),
        # 12. Regex in CSV import
        (
            r'o(/\btrn\b|\btest\s+report\b/)?a(11)',
            r'o(/\b(irn|trn)\b|\b(inspection\s+release|test\s+report)\b/)?a(11)'
        ),
        (
            '|painting|trn|fg|',
            '|painting|irn|trn|fg|'
        ),
        # 13. Product catalog formula & text
        (
            'Painting, TRN, Dispatch)',
            'Painting, IRN, Dispatch)'
        ),
        (
            'Painting, TRN & Dispatch',
            'Painting, IRN & Dispatch'
        ),
        # 14. Yearly report stage 13
        (
            'name:`13. TRN`,category:`Documentation`,primaryCause:`Compiling manufacturer test certificates and inspection dossiers`,improvementTip:`Digitally compile test documents in real time at each stage instead of at the end`,responsibleRole:`QC (TRN)`',
            'name:`13. IRN`,category:`Documentation`,primaryCause:`Compiling manufacturer test certificates and inspection dossiers`,improvementTip:`Digitally compile test documents in real time at each stage instead of at the end`,responsibleRole:`QC (IRN)`'
        ),
        # 15. Yearly report key normalization
        (
            'spatch_clearance`||s===`test_report`?s=`trn`',
            'spatch_clearance`||s===`test_report`||s===`irn`||s===`inspection_release`?s=`trn`'
        ),
        # 16. App module router
        (
            'i===`13. TRN`&&(0,J.jsx)(Dy,{stageKey:`trn`,stageTitle:`13. TRN`,stageOrder:13,responsibleRole:`QC (TRN)`,description:`Issue Test & Release Note (TRN), QA final release dossier, and shipping clearance certificates.`})',
            'i===`13. IRN`&&(0,J.jsx)(Dy,{stageKey:`trn`,stageTitle:`13. IRN`,stageOrder:13,responsibleRole:`QC (IRN)`,description:`Issue Inspection Release Note (IRN), QA final release dossier, and shipping clearance certificates.`})'
        ),
    ]

    new_code = code
    for target, replacement in replacements:
        new_code = new_code.replace(target, replacement)

    new_curly_diff = new_code.count('{') - new_code.count('}')
    new_paren_diff = new_code.count('(') - new_code.count(')')
    new_bracket_diff = new_code.count('[') - new_code.count(']')

    assert new_curly_diff == baseline_curly_diff, f"Curly balance mismatch in {file_path}"
    assert new_paren_diff == baseline_paren_diff, f"Paren balance mismatch in {file_path}"
    assert new_bracket_diff == baseline_bracket_diff, f"Square bracket balance mismatch in {file_path}"

    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(new_code)
    print(f"Successfully updated {file_path}")

if __name__ == '__main__':
    update_bundle('dist/assets/index-latest.js')
    update_bundle('dist/assets/index-BvRAqK4b.js')

